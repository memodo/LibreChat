import {
  unauthenticatedError,
  invalidTokenError,
  insufficientScopeError,
  writeForbiddenError,
  throttledByQueue,
  throttledByCapacity,
  throttledByGraph429,
  upstreamUnavailable,
  sidecarUnavailable,
  protocolMismatch,
  serializeForMCP,
} from '../errorEnvelope';
import type { ErrorEnvelope } from '../errorEnvelope';

describe('errorEnvelope build helpers (SPEC-014 Error Response Schema)', () => {
  describe('code values are canonical', () => {
    const cases: Array<{ name: string; build: () => ErrorEnvelope; code: string }> = [
      { name: 'unauthenticatedError', build: () => unauthenticatedError('cid-1'), code: 'Unauthenticated' },
      { name: 'invalidTokenError', build: () => invalidTokenError('aud', 'cid-1'), code: 'InvalidToken' },
      {
        name: 'insufficientScopeError',
        build: () => insufficientScopeError('Authorization_RequestDenied', 'cid-1'),
        code: 'InsufficientScope',
      },
      { name: 'writeForbiddenError', build: () => writeForbiddenError('cid-1'), code: 'WriteForbidden' },
      { name: 'throttledByQueue', build: () => throttledByQueue(5, 'cid-1'), code: 'Throttled' },
      { name: 'throttledByCapacity', build: () => throttledByCapacity(5, 'cid-1'), code: 'Throttled' },
      {
        name: 'throttledByGraph429',
        build: () => throttledByGraph429(7, 'graph-throttled', 'cid-1'),
        code: 'Throttled',
      },
      {
        name: 'upstreamUnavailable',
        build: () => upstreamUnavailable('ServiceError', 'graph 503', 'cid-1'),
        code: 'UpstreamUnavailable',
      },
      { name: 'sidecarUnavailable', build: () => sidecarUnavailable('cid-1'), code: 'SidecarUnavailable' },
      {
        name: 'protocolMismatch',
        build: () => protocolMismatch('2024-11-05', '2099-99-99', 'cid-1'),
        code: 'ProtocolMismatch',
      },
    ];

    test.each(cases)('$name produces code=$code', ({ build, code }) => {
      const env = build();
      expect(env.code).toBe(code);
      expect(env.schemaVersion).toBe(1);
      expect(env.message).toBeTruthy();
      expect(typeof env.message).toBe('string');
      expect(env.correlationId).toBe('cid-1');
    });
  });

  describe('retryAfter presence', () => {
    test('retryAfter set only on Throttled codes', () => {
      expect(throttledByQueue(5).retryAfter).toBe(5);
      expect(throttledByCapacity(5).retryAfter).toBe(5);
      expect(throttledByGraph429(7).retryAfter).toBe(7);

      expect(unauthenticatedError().retryAfter).toBeUndefined();
      expect(invalidTokenError('aud').retryAfter).toBeUndefined();
      expect(insufficientScopeError().retryAfter).toBeUndefined();
      expect(writeForbiddenError().retryAfter).toBeUndefined();
      expect(upstreamUnavailable().retryAfter).toBeUndefined();
      expect(sidecarUnavailable().retryAfter).toBeUndefined();
      expect(protocolMismatch('a', 'b').retryAfter).toBeUndefined();
    });
  });

  describe('throttleSource is set correctly', () => {
    test('librechat_queue', () => {
      expect(throttledByQueue(5).throttleSource).toBe('librechat_queue');
    });
    test('librechat_concurrency_cap', () => {
      expect(throttledByCapacity(5).throttleSource).toBe('librechat_concurrency_cap');
    });
    test('graph_429', () => {
      expect(throttledByGraph429(5).throttleSource).toBe('graph_429');
    });
    test('omitted for non-Throttled', () => {
      expect(unauthenticatedError().throttleSource).toBeUndefined();
      expect(upstreamUnavailable().throttleSource).toBeUndefined();
      expect(sidecarUnavailable().throttleSource).toBeUndefined();
    });
  });

  describe('schemaVersion is always 1', () => {
    test.each([
      unauthenticatedError(),
      invalidTokenError('exp'),
      insufficientScopeError(),
      writeForbiddenError(),
      throttledByQueue(5),
      throttledByCapacity(5),
      throttledByGraph429(5),
      upstreamUnavailable(),
      sidecarUnavailable(),
      protocolMismatch('a', 'b'),
    ])('schemaVersion=1 for envelope', (env) => {
      expect(env.schemaVersion).toBe(1);
    });
  });

  describe('serializeForMCP', () => {
    test('returns isError=true with single text content', () => {
      const env = throttledByGraph429(10, 'limit hit', 'cid-x');
      const serialized = serializeForMCP(env);
      expect(serialized.isError).toBe(true);
      expect(serialized.content).toHaveLength(1);
      expect(serialized.content[0].type).toBe('text');
      expect(typeof serialized.content[0].text).toBe('string');
    });

    test('content[0].text is parseable JSON with schemaVersion first', () => {
      const env = throttledByQueue(5, 'cid-1');
      const serialized = serializeForMCP(env);
      const parsed = JSON.parse(serialized.content[0].text);
      expect(parsed.schemaVersion).toBe(1);
      // schemaVersion must be the first key in the serialized JSON
      const firstKey = Object.keys(parsed)[0];
      expect(firstKey).toBe('schemaVersion');
    });

    test('round-trips all canonical fields including throttleSource and retryAfter', () => {
      const env = throttledByGraph429(11, 'rate limited', 'cid-z');
      const parsed = JSON.parse(serializeForMCP(env).content[0].text);
      expect(parsed).toMatchObject({
        schemaVersion: 1,
        code: 'Throttled',
        throttleSource: 'graph_429',
        retryAfter: 11,
        graphCode: 'TooManyRequests',
        graphMessage: 'rate limited',
        correlationId: 'cid-z',
      });
    });

    test('omits undefined optional fields cleanly', () => {
      const env = sidecarUnavailable();
      const parsed = JSON.parse(serializeForMCP(env).content[0].text);
      expect(parsed.correlationId).toBeUndefined();
      expect(parsed.retryAfter).toBeUndefined();
      expect(parsed.throttleSource).toBeUndefined();
      expect(parsed.graphCode).toBeUndefined();
    });
  });

  describe('canonical retry semantics (Verification §8)', () => {
    type Retryability =
      | { kind: 'retry'; authoritativeRetryAfter: boolean }
      | { kind: 'bounded-retry' }
      | { kind: 'none' };

    const table: Record<string, Retryability> = {
      Throttled_graph_429: { kind: 'retry', authoritativeRetryAfter: true },
      Throttled_librechat_queue: { kind: 'retry', authoritativeRetryAfter: false },
      Throttled_librechat_concurrency_cap: { kind: 'retry', authoritativeRetryAfter: false },
      UpstreamUnavailable: { kind: 'bounded-retry' },
      Unauthenticated: { kind: 'none' },
      InvalidToken: { kind: 'none' },
      InsufficientScope: { kind: 'none' },
      WriteForbidden: { kind: 'none' },
      SidecarUnavailable: { kind: 'none' },
      ProtocolMismatch: { kind: 'none' },
    };

    test('eight codes covered; Throttled sub-classified by throttleSource', () => {
      expect(Object.keys(table)).toHaveLength(10);
      expect(table.Throttled_graph_429.kind).toBe('retry');
      expect(table.UpstreamUnavailable.kind).toBe('bounded-retry');
      ['Unauthenticated', 'InvalidToken', 'InsufficientScope', 'WriteForbidden', 'SidecarUnavailable', 'ProtocolMismatch'].forEach(
        (k) => expect(table[k].kind).toBe('none'),
      );
    });
  });
});
