import {
  InvalidGraphTokenError,
  SingleFlightCache,
  buildCacheKey,
  classifyOboError,
  getGraphTokenForEmission,
  normalizeScopeKey,
  runOboWithSingleFlightAndRetry,
  runWithOboRetry,
  validateGraphTokenInvariants,
  EMISSION_TOKEN_MIN_TTL_MS,
} from '../graph';
import type { GraphTokenClaims, GraphTokenResponse } from '../graph';

const TENANT_ID = 'tenant-aaaa-bbbb-cccc';
const CLIENT_ID = 'client-id-xyz';
const NOW = 1_700_000_000_000;

function encodeJwt(claims: GraphTokenClaims | Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature`;
}

function validClaims(overrides: Partial<GraphTokenClaims> = {}): GraphTokenClaims {
  return {
    aud: 'https://graph.microsoft.com',
    iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    tid: TENANT_ID,
    ver: '2.0',
    oid: 'user-oid-123',
    upn: 'alice@example.com',
    appid: CLIENT_ID,
    nbf: Math.floor((NOW - 5_000) / 1000),
    exp: Math.floor((NOW + 600_000) / 1000),
    ...overrides,
  };
}

const baseCfg = {
  expectedAudience: 'https://graph.microsoft.com',
  expectedTenantId: TENANT_ID,
  expectedClientId: CLIENT_ID,
  now: () => NOW,
};

describe('validateGraphTokenInvariants (REQ-020)', () => {
  it('accepts a fully valid token', () => {
    expect(() => validateGraphTokenInvariants(encodeJwt(validClaims()), baseCfg)).not.toThrow();
  });

  it('throws on wrong aud', () => {
    const token = encodeJwt(validClaims({ aud: 'https://api.example.com' }));
    try {
      validateGraphTokenInvariants(token, baseCfg);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidGraphTokenError);
      expect((err as InvalidGraphTokenError).invariant).toBe('aud');
    }
  });

  it('throws on tid mismatch', () => {
    const token = encodeJwt(validClaims({ tid: 'different-tenant' }));
    try {
      validateGraphTokenInvariants(token, baseCfg);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidGraphTokenError);
      expect((err as InvalidGraphTokenError).invariant).toBe('tid');
    }
  });

  it('throws on iss tenant mismatch with expected tenant', () => {
    const token = encodeJwt(
      validClaims({
        iss: 'https://login.microsoftonline.com/wrong-tenant/v2.0',
      }),
    );
    try {
      validateGraphTokenInvariants(token, baseCfg);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as InvalidGraphTokenError).invariant).toBe('iss');
    }
  });

  it('throws on near-expiry token', () => {
    const token = encodeJwt(validClaims({ exp: Math.floor((NOW + 1_000) / 1000) }));
    try {
      validateGraphTokenInvariants(token, baseCfg);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as InvalidGraphTokenError).invariant).toBe('exp');
    }
  });

  it('throws on missing oid (app-only token signature)', () => {
    const token = encodeJwt(validClaims({ oid: undefined }));
    try {
      validateGraphTokenInvariants(token, baseCfg);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as InvalidGraphTokenError).invariant).toBe('oid');
    }
  });

  it('throws on appid mismatch (app-only token)', () => {
    const token = encodeJwt(validClaims({ appid: 'some-other-app', azp: undefined }));
    try {
      validateGraphTokenInvariants(token, baseCfg);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as InvalidGraphTokenError).invariant).toBe('appid');
    }
  });

  it('throws on ver !== "2.0"', () => {
    const token = encodeJwt(validClaims({ ver: '1.0' }));
    try {
      validateGraphTokenInvariants(token, baseCfg);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as InvalidGraphTokenError).invariant).toBe('ver');
    }
  });

  it('throws on future-dated nbf', () => {
    const token = encodeJwt(validClaims({ nbf: Math.floor((NOW + 5 * 60_000) / 1000) }));
    try {
      validateGraphTokenInvariants(token, baseCfg);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as InvalidGraphTokenError).invariant).toBe('nbf');
    }
  });

  it('accepts preferred_username when upn is absent', () => {
    const token = encodeJwt(validClaims({ upn: undefined, preferred_username: 'alice@e.com' }));
    expect(() => validateGraphTokenInvariants(token, baseCfg)).not.toThrow();
  });

  it('throws "malformed" on a non-JWT string', () => {
    try {
      validateGraphTokenInvariants('not-a-jwt', baseCfg);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as InvalidGraphTokenError).invariant).toBe('malformed');
    }
  });
});

describe('normalizeScopeKey + buildCacheKey (REQ-022)', () => {
  it('pins canonical normalization for mixed input', () => {
    expect(normalizeScopeKey('User.Read, Mail.Read,Mail.read')).toBe('mail.read,user.read');
  });

  it('treats whitespace-separated and comma-separated identically', () => {
    expect(normalizeScopeKey('User.Read Mail.Read')).toBe(normalizeScopeKey('user.read,mail.read'));
  });

  it('strips empty segments', () => {
    expect(normalizeScopeKey(',  ,User.Read,  , Mail.Read,')).toBe('mail.read,user.read');
  });

  it('lowercases and sorts', () => {
    expect(normalizeScopeKey('Z.scope,A.scope,m.scope')).toBe('a.scope,m.scope,z.scope');
  });

  it('handles array input', () => {
    expect(normalizeScopeKey(['User.Read', 'Mail.Read', 'mail.read'])).toBe('mail.read,user.read');
  });

  it('different scope sets produce different cache keys', () => {
    expect(buildCacheKey('u1', 'Mail.Read,User.Read')).not.toBe(
      buildCacheKey('u1', 'Mail.Read,Calendars.Read'),
    );
  });

  it('same scope set in different forms produce identical cache keys', () => {
    expect(buildCacheKey('u1', 'Mail.Read, User.Read')).toBe(
      buildCacheKey('u1', 'user.read,mail.read'),
    );
  });
});

describe('SingleFlightCache (REQ-021)', () => {
  it('coalesces K=10 concurrent callers onto a single factory invocation', async () => {
    const sf = new SingleFlightCache<string>();
    const factory = jest
      .fn()
      .mockImplementation(
        () => new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 10)),
      );
    const results = await Promise.all(Array.from({ length: 10 }, () => sf.run('k', factory)));
    expect(results).toEqual(Array(10).fill('ok'));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('clears the entry on success, allowing a fresh call after settle', async () => {
    const sf = new SingleFlightCache<string>();
    const factory = jest.fn().mockResolvedValue('v');
    await sf.run('k', factory);
    await sf.run('k', factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('clears the entry on rejection', async () => {
    const sf = new SingleFlightCache<string>();
    const factory = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(sf.run('k', factory)).rejects.toThrow('boom');
    await expect(sf.run('k', factory)).rejects.toThrow('boom');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('different cache keys do NOT coalesce', async () => {
    const sf = new SingleFlightCache<string>();
    const factory = jest
      .fn()
      .mockImplementation(
        (k: string) => new Promise<string>((resolve) => setTimeout(() => resolve(k), 5)),
      );
    await Promise.all([sf.run('a', () => factory('a')), sf.run('b', () => factory('b'))]);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('classifyOboError (REQ-021 retry table)', () => {
  it('classifies 429 as retry', () => {
    expect(classifyOboError({ status: 429 }).cls).toBe('retry');
  });

  it('classifies 500/502/503/504 as retry', () => {
    for (const s of [500, 502, 503, 504]) {
      expect(classifyOboError({ status: s }).cls).toBe('retry');
    }
  });

  it('classifies 400/401/403/404 as surface', () => {
    for (const s of [400, 401, 403, 404]) {
      expect(classifyOboError({ status: s }).cls).toBe('surface');
    }
  });

  it('classifies ECONNRESET as retry', () => {
    expect(classifyOboError({ code: 'ECONNRESET' }).cls).toBe('retry');
  });

  it('classifies EAI_AGAIN as retry', () => {
    expect(classifyOboError({ code: 'EAI_AGAIN' }).cls).toBe('retry');
  });

  it('classifies InvalidGraphTokenError as surface', () => {
    expect(classifyOboError(new InvalidGraphTokenError('aud', 'bad')).cls).toBe('surface');
  });

  it('extracts Retry-After header (seconds) into retryAfterMs', () => {
    const err = { status: 429, headers: { 'retry-after': '0.1' } };
    expect(classifyOboError(err).retryAfterMs).toBe(100);
  });

  it('extracts Retry-After HTTP-date into a positive retryAfterMs (LOW-6)', () => {
    /**
     * Build a future HTTP-date 5 seconds out so the parsed delta is always
     * positive even after a few ms of test clock drift.
     */
    const future = new Date(Date.now() + 5_000).toUTCString();
    const err = { status: 429, headers: { 'retry-after': future } };
    const classified = classifyOboError(err);
    expect(classified.cls).toBe('retry');
    expect(classified.retryAfterMs).toBeGreaterThan(0);
    expect(classified.retryAfterMs).toBeLessThanOrEqual(5_000);
  });

  it('clamps past HTTP-date Retry-After to zero (LOW-6)', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    const err = { status: 429, headers: { 'retry-after': past } };
    const classified = classifyOboError(err);
    expect(classified.cls).toBe('retry');
    expect(classified.retryAfterMs).toBe(0);
  });
});

describe('runWithOboRetry (REQ-021 backoff)', () => {
  it('retries on 503 up to 3 attempts then succeeds', async () => {
    const factory = jest
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ access_token: 't' });
    const result = await runWithOboRetry(factory, {
      sleep: () => Promise.resolve(),
      random: () => 0,
    });
    expect(result).toEqual({ access_token: 't' });
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('surfaces 401 immediately without retry', async () => {
    const factory = jest.fn().mockRejectedValue({ status: 401 });
    await expect(
      runWithOboRetry(factory, { sleep: () => Promise.resolve(), random: () => 0 }),
    ).rejects.toMatchObject({ status: 401 });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After delay over jittered backoff', async () => {
    const sleeps: number[] = [];
    const factory = jest
      .fn()
      .mockRejectedValueOnce({ status: 429, headers: { 'retry-after': '0.1' } })
      .mockResolvedValueOnce({ access_token: 't' });
    await runWithOboRetry(factory, {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0.999,
    });
    expect(sleeps).toEqual([100]);
  });

  it('exhausts all attempts on persistent retry-class errors and re-throws last', async () => {
    const factory = jest.fn().mockRejectedValue({ status: 503 });
    await expect(
      runWithOboRetry(factory, { sleep: () => Promise.resolve(), random: () => 0 }),
    ).rejects.toMatchObject({ status: 503 });
    expect(factory).toHaveBeenCalledTimes(3);
  });
});

describe('runOboWithSingleFlightAndRetry (REQ-021 single-flight + retry)', () => {
  function tokenResponse(): GraphTokenResponse {
    return {
      access_token: 't',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mail.read',
    };
  }

  it('K=10 concurrent callers, upstream returns 503 twice then 200: ≤3 underlying calls, all succeed', async () => {
    let attempts = 0;
    const factory = jest.fn().mockImplementation(async () => {
      attempts++;
      if (attempts <= 2) {
        const err: { status: number } = { status: 503 };
        throw err;
      }
      return tokenResponse();
    });
    const key = `k-${Math.random()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        runOboWithSingleFlightAndRetry(key, factory, {
          sleep: () => Promise.resolve(),
          random: () => 0,
        }),
      ),
    );
    expect(results).toHaveLength(10);
    expect(results.every((r) => r.access_token === 't')).toBe(true);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('K=10 concurrent callers, upstream returns 200 once: 1 underlying call', async () => {
    const factory = jest
      .fn()
      .mockImplementation(
        () =>
          new Promise<GraphTokenResponse>((resolve) =>
            setTimeout(() => resolve(tokenResponse()), 5),
          ),
      );
    const key = `k-${Math.random()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        runOboWithSingleFlightAndRetry(key, factory, {
          sleep: () => Promise.resolve(),
          random: () => 0,
        }),
      ),
    );
    expect(results).toHaveLength(10);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('K=10 concurrent callers, upstream returns 401: 10 errors, 1 underlying call (no retry)', async () => {
    const factory = jest.fn().mockRejectedValue({ status: 401 });
    const key = `k-${Math.random()}`;
    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        runOboWithSingleFlightAndRetry(key, factory, {
          sleep: () => Promise.resolve(),
          random: () => 0,
        }),
      ),
    );
    expect(settled.every((s) => s.status === 'rejected')).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('K=10 concurrent callers across 10 different keys: 10 underlying calls (no cross-key coalesce)', async () => {
    const factory = jest.fn().mockResolvedValue(tokenResponse());
    const seed = Math.random();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        runOboWithSingleFlightAndRetry(`k-${seed}-${i}`, factory, {
          sleep: () => Promise.resolve(),
          random: () => 0,
        }),
      ),
    );
    expect(factory).toHaveBeenCalledTimes(10);
  });
});

describe('getGraphTokenForEmission (PERF-003)', () => {
  function token(remainingMs: number): GraphTokenResponse {
    const expiresInSec = Math.max(1, Math.ceil(remainingMs / 1000));
    return {
      access_token: 'cached',
      token_type: 'Bearer',
      expires_in: expiresInSec,
      scope: 'mail.read',
      acquired_at: NOW - 1_000,
    };
  }

  it('returns cached token when remaining TTL ≥ 60s (e.g., 61s)', async () => {
    const cached = token(61_000 + 1_000);
    const refresh = jest.fn();
    const result = await getGraphTokenForEmission(cached, refresh, () => NOW);
    expect(result).toBe(cached);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes when remaining TTL < 60s (e.g., 59s)', async () => {
    const cached = token(59_000 + 1_000);
    const fresh: GraphTokenResponse = {
      access_token: 'fresh',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mail.read',
    };
    const refresh = jest.fn().mockResolvedValue(fresh);
    const result = await getGraphTokenForEmission(cached, refresh, () => NOW);
    expect(result).toBe(fresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when no cached token is supplied', async () => {
    const fresh: GraphTokenResponse = {
      access_token: 'fresh',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mail.read',
    };
    const refresh = jest.fn().mockResolvedValue(fresh);
    const result = await getGraphTokenForEmission(null, refresh, () => NOW);
    expect(result).toBe(fresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when cached token has no acquired_at marker (unknown freshness)', async () => {
    const cached: GraphTokenResponse = {
      access_token: 'mystery',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mail.read',
    };
    const fresh: GraphTokenResponse = { ...cached, access_token: 'fresh' };
    const refresh = jest.fn().mockResolvedValue(fresh);
    const result = await getGraphTokenForEmission(cached, refresh, () => NOW);
    expect(result.access_token).toBe('fresh');
  });

  it('uses the EMISSION_TOKEN_MIN_TTL_MS constant for the threshold', () => {
    expect(EMISSION_TOKEN_MIN_TTL_MS).toBe(60_000);
  });
});
