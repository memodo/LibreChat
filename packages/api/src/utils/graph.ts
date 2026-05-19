import { logger } from '@librechat/data-schemas';
import type { IUser } from '@librechat/data-schemas';
import {
  GRAPH_TOKEN_PLACEHOLDER,
  DEFAULT_GRAPH_SCOPES,
  extractOpenIDTokenInfo,
  isOpenIDTokenValid,
} from './oidc';

/**
 * Minimum remaining lifetime (ms) at Bearer-header emission below which
 * `GraphTokenService` MUST refresh the OBO token before returning it.
 * Per SPEC-014 REQ-020 / PERF-003.
 */
export const EMISSION_TOKEN_MIN_TTL_MS = 60_000;

/**
 * Clock-skew tolerance applied to `nbf` and `exp` checks (ms).
 */
export const TOKEN_CLOCK_SKEW_MS = 60_000;

/**
 * Pre-computed regex for matching the Graph token placeholder.
 * Escapes curly braces in the placeholder string for safe regex use.
 */
const GRAPH_TOKEN_REGEX = new RegExp(GRAPH_TOKEN_PLACEHOLDER.replace(/[{}]/g, '\\$&'), 'g');

/**
 * Response from a Graph API token exchange.
 *
 * `acquired_at` is a wall-clock millisecond timestamp set by `GraphTokenService`
 * when the OBO exchange completes. It is the authoritative anchor for the
 * PERF-003 emission-time freshness re-check (`now - acquired_at` plus
 * `expires_in` yields remaining TTL).
 */
export interface GraphTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  acquired_at?: number;
}

/**
 * Function type for resolving Graph API tokens via OBO flow.
 * This function is injected from the main API layer since it requires
 * access to OpenID configuration and caching services.
 */
export type GraphTokenResolver = (
  user: IUser,
  accessToken: string,
  scopes: string,
  fromCache?: boolean,
) => Promise<GraphTokenResponse>;

/**
 * Options for processing Graph token placeholders.
 */
export interface GraphTokenOptions {
  user?: IUser;
  graphTokenResolver?: GraphTokenResolver;
  scopes?: string;
}

/**
 * Checks if a string contains the Graph token placeholder.
 * @param value - The string to check
 * @returns True if the placeholder is present
 */
export function containsGraphTokenPlaceholder(value: string): boolean {
  return typeof value === 'string' && value.includes(GRAPH_TOKEN_PLACEHOLDER);
}

/**
 * Checks if any value in a record contains the Graph token placeholder.
 * @param record - The record to check (e.g., headers, env vars)
 * @returns True if any value contains the placeholder
 */
export function recordContainsGraphTokenPlaceholder(
  record: Record<string, string> | undefined,
): boolean {
  if (!record || typeof record !== 'object') {
    return false;
  }
  return Object.values(record).some(containsGraphTokenPlaceholder);
}

/**
 * Checks if MCP options contain the Graph token placeholder in headers, env, or url.
 * @param options - The MCP options object
 * @returns True if any field contains the placeholder
 */
export function mcpOptionsContainGraphTokenPlaceholder(options: {
  headers?: Record<string, string>;
  env?: Record<string, string>;
  url?: string;
}): boolean {
  if (options.url && containsGraphTokenPlaceholder(options.url)) {
    return true;
  }
  if (recordContainsGraphTokenPlaceholder(options.headers)) {
    return true;
  }
  if (recordContainsGraphTokenPlaceholder(options.env)) {
    return true;
  }
  return false;
}

/**
 * Asynchronously resolves Graph token placeholders in a string.
 * This function must be called before the synchronous processMCPEnv pipeline.
 *
 * @param value - The string containing the placeholder
 * @param options - Options including user and graph token resolver
 * @returns The string with Graph token placeholder replaced
 */
export async function resolveGraphTokenPlaceholder(
  value: string,
  options: GraphTokenOptions,
): Promise<string> {
  if (!containsGraphTokenPlaceholder(value)) {
    return value;
  }

  const { user, graphTokenResolver, scopes } = options;

  if (!user || !graphTokenResolver) {
    logger.warn(
      '[resolveGraphTokenPlaceholder] User or graphTokenResolver not provided, cannot resolve Graph token',
    );
    return value;
  }

  const tokenInfo = extractOpenIDTokenInfo(user);
  if (!tokenInfo || !isOpenIDTokenValid(tokenInfo)) {
    logger.warn(
      '[resolveGraphTokenPlaceholder] No valid OpenID token available for Graph token exchange',
    );
    return value;
  }

  if (!tokenInfo.accessToken) {
    logger.warn('[resolveGraphTokenPlaceholder] No access token available for OBO exchange');
    return value;
  }

  try {
    const graphScopes = scopes || process.env.GRAPH_API_SCOPES || DEFAULT_GRAPH_SCOPES;
    const graphTokenResponse = await graphTokenResolver(
      user,
      tokenInfo.accessToken,
      graphScopes,
      true, // Use cache
    );

    if (graphTokenResponse?.access_token) {
      return value.replace(GRAPH_TOKEN_REGEX, graphTokenResponse.access_token);
    }

    logger.warn(
      '[resolveGraphTokenPlaceholder] Graph token exchange did not return an access token',
    );
    return value;
  } catch (error) {
    logger.error('[resolveGraphTokenPlaceholder] Failed to exchange token for Graph API:', error);
    return value;
  }
}

/**
 * Asynchronously resolves Graph token placeholders in a record of string values.
 *
 * @param record - The record containing placeholders (e.g., headers)
 * @param options - Options including user and graph token resolver
 * @returns The record with Graph token placeholders replaced
 */
export async function resolveGraphTokensInRecord(
  record: Record<string, string> | undefined,
  options: GraphTokenOptions,
): Promise<Record<string, string> | undefined> {
  if (!record || typeof record !== 'object') {
    return record;
  }

  if (!recordContainsGraphTokenPlaceholder(record)) {
    return record;
  }

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    resolved[key] = await resolveGraphTokenPlaceholder(value, options);
  }
  return resolved;
}

/**
 * Pre-processes MCP options to resolve Graph token placeholders.
 * This must be called before processMCPEnv since Graph token resolution is async.
 *
 * @param options - The MCP options object
 * @param graphOptions - Options for Graph token resolution
 * @returns The options with Graph token placeholders resolved
 */
export async function preProcessGraphTokens<
  T extends {
    headers?: Record<string, string>;
    env?: Record<string, string>;
    url?: string;
  },
>(options: T, graphOptions: GraphTokenOptions): Promise<T> {
  if (!mcpOptionsContainGraphTokenPlaceholder(options)) {
    return options;
  }

  const result = { ...options };

  if (result.url && containsGraphTokenPlaceholder(result.url)) {
    result.url = await resolveGraphTokenPlaceholder(result.url, graphOptions);
  }

  if (result.headers) {
    result.headers = await resolveGraphTokensInRecord(result.headers, graphOptions);
  }

  if (result.env) {
    result.env = await resolveGraphTokensInRecord(result.env, graphOptions);
  }

  return result;
}

/**
 * JWT-invariant names — the value passed to `InvalidGraphTokenError`
 * and the structured log event `graph.token.invariant_failure`.
 * Per SPEC-014 REQ-020.
 */
export type GraphTokenInvariant =
  | 'aud'
  | 'iss'
  | 'tid'
  | 'ver'
  | 'oid'
  | 'upn'
  | 'appid'
  | 'nbf'
  | 'exp'
  | 'malformed';

/**
 * Thrown when a Graph access token fails one of the SPEC-014 REQ-020 invariants.
 * Surfaces upstream as `code: "InvalidToken"` per the Error Response Schema.
 */
export class InvalidGraphTokenError extends Error {
  readonly invariant: GraphTokenInvariant;
  constructor(invariant: GraphTokenInvariant, message: string) {
    super(message);
    this.name = 'InvalidGraphTokenError';
    this.invariant = invariant;
  }
}

/**
 * Subset of the JWT claims relevant to REQ-020 invariants. Microsoft signs
 * the token upstream; we only validate claim shape, not signature — Graph
 * is the authority on signature validity.
 */
export interface GraphTokenClaims {
  aud?: string;
  iss?: string;
  tid?: string;
  ver?: string;
  oid?: string;
  upn?: string;
  preferred_username?: string;
  appid?: string;
  azp?: string;
  nbf?: number;
  exp?: number;
}

/**
 * Configuration thresholds for `validateGraphTokenInvariants`. Defaults
 * come from environment variables resolved at call time so test paths can
 * override via env without bleeding state across suites.
 */
export interface GraphTokenInvariantConfig {
  expectedAudience?: string;
  expectedTenantId?: string;
  expectedClientId?: string;
  clockSkewMs?: number;
  safetyMarginMs?: number;
  now?: () => number;
}

const ISS_REGEX =
  /^https:\/\/(login\.microsoftonline\.com|sts\.windows\.net)\/([^/]+)\/(?:v2\.0)?$/;

function decodeJwtPayload(token: string): GraphTokenClaims {
  if (typeof token !== 'string' || token.length === 0) {
    throw new InvalidGraphTokenError('malformed', 'token is empty');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new InvalidGraphTokenError('malformed', 'token must have three JWT segments');
  }
  const payloadSegment = parts[1];
  if (!payloadSegment) {
    throw new InvalidGraphTokenError('malformed', 'token payload segment is empty');
  }
  const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  try {
    const decoded = Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8');
    return JSON.parse(decoded) as GraphTokenClaims;
  } catch {
    throw new InvalidGraphTokenError('malformed', 'token payload is not valid base64url JSON');
  }
}

function resolveInvariantConfig(cfg: GraphTokenInvariantConfig | undefined): Required<
  Omit<GraphTokenInvariantConfig, 'expectedTenantId' | 'expectedClientId'>
> & {
  expectedTenantId?: string;
  expectedClientId?: string;
} {
  const expectedAudience =
    cfg?.expectedAudience ?? process.env.GRAPH_EXPECTED_AUDIENCE ?? 'https://graph.microsoft.com';
  const expectedTenantId = cfg?.expectedTenantId ?? process.env.MEMODO_TENANT_ID;
  const expectedClientId = cfg?.expectedClientId ?? process.env.OPENID_CLIENT_ID;
  const clockSkewMs = cfg?.clockSkewMs ?? TOKEN_CLOCK_SKEW_MS;
  const safetyMarginMs = cfg?.safetyMarginMs ?? EMISSION_TOKEN_MIN_TTL_MS;
  const now = cfg?.now ?? Date.now;
  return { expectedAudience, expectedTenantId, expectedClientId, clockSkewMs, safetyMarginMs, now };
}

/**
 * Validates a Graph access token against the SPEC-014 REQ-020 JWT invariants.
 * Throws `InvalidGraphTokenError` on the first failed invariant.
 *
 * Signature verification is NOT performed: Microsoft signs upstream and Graph
 * is the authority on signature validity. This function only validates the
 * claim shape required for per-user attribution (SEC-004) and confused-deputy
 * defense (rejecting app-only / cross-tenant tokens).
 *
 * @param token - The JWT (Bearer) string to validate
 * @param cfg - Optional config overrides (defaults to env-var lookup)
 */
export function validateGraphTokenInvariants(token: string, cfg?: GraphTokenInvariantConfig): void {
  const claims = decodeJwtPayload(token);
  const { expectedAudience, expectedTenantId, expectedClientId, clockSkewMs, safetyMarginMs, now } =
    resolveInvariantConfig(cfg);

  if (claims.aud !== expectedAudience) {
    throw new InvalidGraphTokenError(
      'aud',
      `aud claim "${claims.aud ?? ''}" does not match expected "${expectedAudience}"`,
    );
  }

  const issMatch = typeof claims.iss === 'string' ? ISS_REGEX.exec(claims.iss) : null;
  if (!issMatch) {
    throw new InvalidGraphTokenError(
      'iss',
      `iss claim "${claims.iss ?? ''}" does not match tenant-scoped issuer pattern`,
    );
  }
  const issTenant = issMatch[2];

  if (claims.ver !== '2.0') {
    throw new InvalidGraphTokenError('ver', `ver claim "${claims.ver ?? ''}" is not "2.0"`);
  }

  if (expectedTenantId) {
    if (claims.tid !== expectedTenantId) {
      throw new InvalidGraphTokenError(
        'tid',
        `tid claim "${claims.tid ?? ''}" does not match expected tenant`,
      );
    }
    if (issTenant !== expectedTenantId) {
      throw new InvalidGraphTokenError(
        'iss',
        `iss tenant segment "${issTenant}" does not match expected tenant`,
      );
    }
  } else if (claims.tid !== issTenant) {
    throw new InvalidGraphTokenError(
      'tid',
      `tid "${claims.tid ?? ''}" does not match iss-extracted tenant "${issTenant}"`,
    );
  }

  if (!claims.oid || claims.oid.length === 0) {
    throw new InvalidGraphTokenError('oid', 'oid claim is missing or empty (app-only token?)');
  }

  if (!claims.upn && !claims.preferred_username) {
    throw new InvalidGraphTokenError('upn', 'neither upn nor preferred_username claim is present');
  }

  const tokenAppId = claims.appid ?? claims.azp;
  if (expectedClientId && tokenAppId !== expectedClientId) {
    throw new InvalidGraphTokenError(
      'appid',
      `appid/azp "${tokenAppId ?? ''}" does not match expected client id`,
    );
  }

  const currentMs = now();
  if (typeof claims.nbf === 'number' && claims.nbf * 1000 > currentMs + clockSkewMs) {
    throw new InvalidGraphTokenError(
      'nbf',
      `nbf ${claims.nbf} is beyond now + clockSkew (${currentMs + clockSkewMs}ms)`,
    );
  }

  if (typeof claims.exp !== 'number') {
    throw new InvalidGraphTokenError('exp', 'exp claim is missing');
  }
  const remainingMs = claims.exp * 1000 - currentMs;
  if (remainingMs < safetyMarginMs) {
    throw new InvalidGraphTokenError(
      'exp',
      `remaining lifetime ${remainingMs}ms < safety margin ${safetyMarginMs}ms`,
    );
  }
}

/**
 * Normalizes a scope list for deterministic cache-key hashing.
 * Per SPEC-014 REQ-022: trim, lowercase, dedup, sort, comma-join.
 */
export function normalizeScopeKey(scopes: string | string[]): string {
  const list = typeof scopes === 'string' ? scopes.split(/[,\s]+/) : scopes;
  const cleaned: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    cleaned.push(trimmed);
  }
  return Array.from(new Set(cleaned)).sort().join(',');
}

/**
 * Builds the per-user OBO cache key per REQ-022.
 */
export function buildCacheKey(userOpenIdId: string, scopes: string | string[]): string {
  return `${userOpenIdId}:${normalizeScopeKey(scopes)}`;
}

/**
 * Coalesces concurrent operations under the same key onto a single in-flight
 * promise. Implements the REQ-021 single-flight invariant: K concurrent
 * callers observe exactly ONE underlying factory invocation per key.
 */
export class SingleFlightCache<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  async run(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const promise = factory().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  size(): number {
    return this.inFlight.size;
  }
}

/**
 * Classification of an upstream OBO-exchange error. Per REQ-021:
 * `retry` = bounded backoff inside the single-flight call;
 * `surface` = short-circuit immediately, no retry.
 */
export type OboErrorClass = 'retry' | 'surface';

interface ClassifiedError {
  cls: OboErrorClass;
  retryAfterMs?: number;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const SURFACE_STATUSES = new Set([400, 401, 403, 404]);
const RETRY_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND']);

function extractStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.statusCode === 'number') return e.statusCode;
  if (e.response && typeof e.response.status === 'number') return e.response.status;
  return undefined;
}

function extractRetryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as {
    headers?: { get?: (k: string) => string | null; [k: string]: unknown };
    response?: { headers?: { get?: (k: string) => string | null; [k: string]: unknown } };
  };
  const headerSources = [e.headers, e.response?.headers].filter(Boolean) as Array<{
    get?: (k: string) => string | null;
    [k: string]: unknown;
  }>;
  for (const src of headerSources) {
    let raw: string | null | undefined;
    if (typeof src.get === 'function') {
      raw = src.get('retry-after');
    } else if (typeof src['retry-after'] === 'string') {
      raw = src['retry-after'] as string;
    } else if (typeof src['Retry-After'] === 'string') {
      raw = src['Retry-After'] as string;
    }
    if (raw) {
      const seconds = Number(raw);
      if (Number.isFinite(seconds)) return seconds * 1000;
      /**
       * LOW-6 fix — RFC 7231 §7.1.3 also permits an HTTP-date form
       * (e.g., `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`). Graph
       * typically uses seconds but Azure throttling responses occasionally
       * use HTTP-date; honor both. Past timestamps clamp to 0.
       */
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) {
        const delta = parsed - Date.now();
        return delta > 0 ? delta : 0;
      }
    }
  }
  return undefined;
}

function extractErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { code?: unknown };
  if (typeof e.code === 'string') return e.code;
  return undefined;
}

/**
 * Classifies an OBO-exchange error against the REQ-021 retry table.
 */
export function classifyOboError(err: unknown): ClassifiedError {
  if (err instanceof InvalidGraphTokenError) {
    return { cls: 'surface' };
  }
  const status = extractStatusCode(err);
  if (typeof status === 'number') {
    if (RETRY_STATUSES.has(status)) {
      return { cls: 'retry', retryAfterMs: extractRetryAfterMs(err) };
    }
    if (SURFACE_STATUSES.has(status)) {
      return { cls: 'surface' };
    }
  }
  const code = extractErrorCode(err);
  if (code && RETRY_CODES.has(code)) {
    return { cls: 'retry' };
  }
  /**
   * LOW-5 fix — log unrecognized error shapes (sanitized) so operators
   * notice new Graph error codes that ought to be classified as retry.
   * Default `surface` per REQ-021's conservative-default rule.
   */
  const errName =
    err && typeof err === 'object' && typeof (err as { name?: unknown }).name === 'string'
      ? ((err as { name: string }).name as string)
      : undefined;
  const errMessage =
    err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
      ? ((err as { message: string }).message as string)
      : undefined;
  logger.warn('graph.obo.unrecognized_error_shape', {
    name: errName,
    status,
    code,
    message: errMessage,
  });
  return { cls: 'surface' };
}

interface BackoffOptions {
  maxAttempts?: number;
  baseMs?: number;
  capMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps a factory with the REQ-021 retry-with-jittered-backoff policy.
 * Retries are bounded to `maxAttempts` (default 3) total attempts.
 * Backoff is full-jitter capped at `capMs`. Honors Retry-After when present.
 */
export async function runWithOboRetry<T>(
  factory: () => Promise<T>,
  opts: BackoffOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseMs = opts.baseMs ?? 200;
  const capMs = opts.capMs ?? 1500;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await factory();
    } catch (err) {
      lastErr = err;
      const classified = classifyOboError(err);
      if (classified.cls === 'surface' || attempt === maxAttempts - 1) {
        throw err;
      }
      const expBackoff = Math.min(capMs, baseMs * 2 ** attempt);
      const jittered = random() * expBackoff;
      const delay = classified.retryAfterMs ?? jittered;
      await sleep(Math.min(capMs, delay));
    }
  }
  throw lastErr;
}

/**
 * Shared single-flight cache instance for OBO exchange coalescing.
 * Module-scoped so legacy JS and new TS callers see the same in-flight map.
 */
export const oboSingleFlight = new SingleFlightCache<GraphTokenResponse>();

/**
 * Combined single-flight + retry wrapper. Concurrent callers on the same
 * cache key ride out the retry loop as ONE coalesced operation per REQ-021.
 *
 * @param cacheKey - Normalized cache key from `buildCacheKey`
 * @param factory - The underlying OBO exchange call
 * @param opts - Optional backoff overrides (used in tests)
 */
export function runOboWithSingleFlightAndRetry(
  cacheKey: string,
  factory: () => Promise<GraphTokenResponse>,
  opts?: BackoffOptions,
): Promise<GraphTokenResponse> {
  return oboSingleFlight.run(cacheKey, () => runWithOboRetry(factory, opts));
}

/**
 * Resolves the Bearer-header token at emission time per PERF-003.
 * If the supplied cached token still has ≥ `EMISSION_TOKEN_MIN_TTL_MS`
 * remaining lifetime, returns it as-is. Otherwise refreshes via the
 * supplied `refresh` factory, which itself MUST route through
 * `runOboWithSingleFlightAndRetry` for REQ-021 coalescing.
 *
 * @param current - Currently-cached token response, if any
 * @param refresh - Factory producing a fresh OBO token
 * @param now - Optional clock injection for tests
 */
export async function getGraphTokenForEmission(
  current: GraphTokenResponse | null | undefined,
  refresh: () => Promise<GraphTokenResponse>,
  now: () => number = Date.now,
): Promise<GraphTokenResponse> {
  if (current?.access_token && typeof current.expires_in === 'number') {
    const issuedAtMs = current.acquired_at;
    if (typeof issuedAtMs === 'number') {
      const remaining = issuedAtMs + current.expires_in * 1000 - now();
      if (remaining >= EMISSION_TOKEN_MIN_TTL_MS) {
        return current;
      }
    }
  }
  return refresh();
}
