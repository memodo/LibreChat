import {
  MCPCallQueue,
  MICROSOFT365_QUEUE_DEFAULTS,
  MCP_HOP_BUDGET_MS,
  assertCascadingTimeoutInvariant,
  buildCorrelationId,
} from '../queue';
import type {
  MCPCallContext,
  MCPCallExecutor,
  MCPCallExecutorParams,
  QueueGraphTokenResolver,
} from '../queue';
import {
  QueueDepthExceededError,
  QueueWaitTimedOutError,
  QueueCancelledError,
} from '../errorEnvelope';

/**
 * Make a fresh queue with permissive defaults but real spec values.
 * Tests override individual options where needed.
 */
function makeQueue(
  overrides: Partial<typeof MICROSOFT365_QUEUE_DEFAULTS> = {},
  resolver?: QueueGraphTokenResolver,
): MCPCallQueue {
  return new MCPCallQueue(
    'Microsoft365',
    { ...MICROSOFT365_QUEUE_DEFAULTS, ...overrides },
    resolver,
  );
}

function makeCtx(overrides: Partial<MCPCallContext> = {}): MCPCallContext {
  return {
    userId: 'user-a',
    userOpenIdId: 'openid-a',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    toolCallId: `tc-${Math.random().toString(36).slice(2, 8)}`,
    scopes: 'User.Read,Mail.Read',
    ...overrides,
  };
}

/** Deferred helper for controllable executors. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('MCPCallQueue', () => {
  describe('cascading-timeout invariant (REQ-025)', () => {
    test('spec defaults satisfy queue_wait + graph_inner + hop < outer', () => {
      const o = MICROSOFT365_QUEUE_DEFAULTS;
      const sum = o.queueWaitTimeoutMs + o.innerGraphTimeoutMs + MCP_HOP_BUDGET_MS;
      expect(sum).toBe(44_500);
      expect(sum).toBeLessThan(o.outerTimeoutMs);
      expect(o.outerTimeoutMs).toBe(45_000);
      expect(() => assertCascadingTimeoutInvariant(o)).not.toThrow();
    });

    test('violating invariant throws at construction', () => {
      expect(() =>
        makeQueue({ queueWaitTimeoutMs: 30_000, innerGraphTimeoutMs: 30_000 }),
      ).toThrow(/Cascading-timeout invariant violated/);
    });
  });

  describe('correlation-ID format (REQ-023)', () => {
    test('${conversationId}:${messageId}:${toolCallId}', () => {
      const ctx = makeCtx({
        conversationId: 'CONV',
        messageId: 'MSG',
        toolCallId: 'TC',
      });
      expect(buildCorrelationId(ctx)).toBe('CONV:MSG:TC');
    });
  });

  describe('in-flight cap (4 per user)', () => {
    test('5 concurrent calls: 4 run, 5th queues, then dequeues after one completes', async () => {
      const q = makeQueue();
      const deferreds = Array.from({ length: 5 }, () => deferred<string>());
      const runOrder: number[] = [];

      const promises = deferreds.map((d, i) =>
        q.enqueue(makeCtx({ toolCallId: `tc-${i}` }), async () => {
          runOrder.push(i);
          return d.promise;
        }),
      );

      await Promise.resolve();
      await Promise.resolve();

      expect(runOrder).toEqual([0, 1, 2, 3]);
      expect(q.snapshot().queued).toBe(1);
      expect(q.inFlightCountForUser('user-a')).toBe(4);

      deferreds[0].resolve('done-0');
      await promises[0];

      await Promise.resolve();
      await Promise.resolve();

      expect(runOrder).toContain(4);
      expect(q.inFlightCountForUser('user-a')).toBe(4);

      for (let i = 1; i < 5; i++) deferreds[i].resolve(`done-${i}`);
      await Promise.all(promises);
      expect(q.inFlightCountForUser('user-a')).toBe(0);
    });
  });

  describe('queue depth cap (REQ-024)', () => {
    test('beyond 16 queued + 4 in-flight, additional calls reject with QueueDepthExceededError', async () => {
      // Short queueWaitTimeoutMs ensures the test cleans up quickly even
      // though the failure mode under test is the synchronous depth check
      // BEFORE any wait. innerGraphTimeoutMs trimmed accordingly to keep
      // the cascading-timeout invariant satisfied.
      const q = makeQueue({
        queueWaitTimeoutMs: 50,
        innerGraphTimeoutMs: 200,
        outerTimeoutMs: 1_000,
      });
      const deferreds = Array.from({ length: 25 }, () => deferred<string>());
      const promises: Promise<string>[] = [];

      for (let i = 0; i < 25; i++) {
        const exec: MCPCallExecutor<string> = async () => deferreds[i].promise;
        const p = q.enqueue(makeCtx({ toolCallId: `tc-${i}` }), exec);
        promises.push(p);
        p.catch(() => {});
      }

      // Drain microtasks so depth checks settle.
      for (let i = 0; i < 5; i++) await Promise.resolve();

      const results = await Promise.allSettled(
        promises.map((p) => Promise.race([p, new Promise((r) => setTimeout(() => r('pending'), 200))])),
      );
      const depthExceeded = results.filter(
        (r) => r.status === 'rejected' && (r.reason as Error) instanceof QueueDepthExceededError,
      );

      // 25 calls - 4 in-flight - 16 queued = EXACTLY 5 that must hit the depth cap.
      // Tightened from `>=5` per Step 4e MEDIUM/test-gap-4 — a regression in the
      // depth-cap counter that produced 6+ rejections would otherwise pass silently.
      expect(depthExceeded).toHaveLength(5);

      // Resolve remaining in-flight so test exits cleanly.
      deferreds.forEach((d) => d.resolve('ok'));
      await Promise.allSettled(promises);
    }, 30_000);
  });

  describe('queue-wait timeout (REQ-024 / REQ-025)', () => {
    test('call sitting in queue beyond queueWaitTimeoutMs throws QueueWaitTimedOutError', async () => {
      jest.useFakeTimers();
      try {
        const q = makeQueue({ queueWaitTimeoutMs: 50 });

        const blockers = Array.from({ length: 4 }, () => deferred<string>());
        for (let i = 0; i < 4; i++) {
          q.enqueue(makeCtx({ toolCallId: `block-${i}` }), () => blockers[i].promise).catch(
            () => {},
          );
        }
        await Promise.resolve();
        await Promise.resolve();

        const waitingPromise = q.enqueue(
          makeCtx({ toolCallId: 'waiter' }),
          async () => 'should-not-run',
        );
        const settled = waitingPromise.catch((e: unknown) => e);

        jest.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();

        const err = await settled;
        expect(err).toBeInstanceOf(QueueWaitTimedOutError);

        blockers.forEach((b) => b.resolve('ok'));
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('outer timeout cancellation (REQ-025)', () => {
    test('executor not honoring abort within outerTimeoutMs has slot released after grace', async () => {
      jest.useFakeTimers();
      try {
        const q = makeQueue({
          outerTimeoutMs: 1_000,
          gracePeriodMs: 200,
          queueWaitTimeoutMs: 100,
          innerGraphTimeoutMs: 200,
        });
        let aborted = false;

        const exec: MCPCallExecutor<string> = ({ abortSignal }) =>
          new Promise<string>(() => {
            abortSignal.addEventListener('abort', () => {
              aborted = true;
            });
          });

        const callPromise = q.enqueue(makeCtx({ toolCallId: 'long' }), exec);
        const settled = callPromise.catch((e: unknown) => e);

        await Promise.resolve();
        await Promise.resolve();
        expect(q.inFlightCountForUser('user-a')).toBe(1);

        // outer fires at 1000ms — signals abort
        jest.advanceTimersByTime(1_000);
        await Promise.resolve();
        expect(aborted).toBe(true);

        // grace timer fires at +200ms — slot force-released, late result dropped
        jest.advanceTimersByTime(250);
        await Promise.resolve();
        await Promise.resolve();

        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/grace/);
        expect(q.inFlightCountForUser('user-a')).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    test('executor honoring abort completes promptly, releasing the slot', async () => {
      jest.useFakeTimers();
      try {
        const q = makeQueue({
          outerTimeoutMs: 1_000,
          gracePeriodMs: 200,
          queueWaitTimeoutMs: 100,
          innerGraphTimeoutMs: 200,
        });

        const exec: MCPCallExecutor<string> = ({ abortSignal }) =>
          new Promise<string>((_, reject) => {
            abortSignal.addEventListener('abort', () => reject(new Error('aborted by signal')));
          });

        const callPromise = q.enqueue(makeCtx({ toolCallId: 'cancellable' }), exec);
        const settled = callPromise.catch((e: unknown) => e);

        await Promise.resolve();
        await Promise.resolve();

        jest.advanceTimersByTime(1_000);
        await Promise.resolve();
        await Promise.resolve();

        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/aborted/);
        expect(q.inFlightCountForUser('user-a')).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('external AbortSignal', () => {
    test('caller signal fires before dequeue: QueueCancelledError; slot not consumed', async () => {
      const q = makeQueue({ queueWaitTimeoutMs: 500 });

      const blockers = Array.from({ length: 4 }, () => deferred<string>());
      for (let i = 0; i < 4; i++) {
        q.enqueue(makeCtx({ toolCallId: `block-${i}` }), () => blockers[i].promise).catch(() => {});
      }
      await Promise.resolve();
      await Promise.resolve();

      const controller = new AbortController();
      const waiter = q.enqueue(
        makeCtx({ toolCallId: 'cancel-me', abortSignal: controller.signal }),
        async () => 'should-not-run',
      );
      const settled = waiter.catch((e: unknown) => e);

      controller.abort();
      const err = await settled;
      expect(err).toBeInstanceOf(QueueCancelledError);

      blockers.forEach((b) => b.resolve('ok'));
    });

    test('caller signal already aborted: rejects immediately', async () => {
      const q = makeQueue();
      const controller = new AbortController();
      controller.abort();

      await expect(
        q.enqueue(
          makeCtx({ toolCallId: 'pre-aborted', abortSignal: controller.signal }),
          async () => 'never',
        ),
      ).rejects.toBeInstanceOf(QueueCancelledError);
    });
  });

  describe('null-token-emission (REQ-015 contract)', () => {
    test('graphTokenResolver returning null surfaces authorizationHeader=null to executor', async () => {
      const resolver: QueueGraphTokenResolver = jest.fn().mockResolvedValue(null);
      const q = makeQueue({}, resolver);

      let received: MCPCallExecutorParams | null = null;
      const result = await q.enqueue(makeCtx({ toolCallId: 'null-token' }), async (params) => {
        received = params;
        return 'ok';
      });
      expect(result).toBe('ok');
      expect(received).not.toBeNull();
      expect(received!.authorizationHeader).toBeNull();
      expect(received!.correlationId).toBe('conv-1:msg-1:null-token');
    });
  });

  describe('post-dequeue token resolution (PERF-003 contract)', () => {
    test('graphTokenResolver invoked AFTER dequeue (not at enqueue)', async () => {
      const calls: Array<{ at: number }> = [];
      const start = Date.now();
      const resolver: QueueGraphTokenResolver = jest.fn(async () => {
        calls.push({ at: Date.now() - start });
        return 'Bearer abc';
      });

      const q = makeQueue({}, resolver);

      const blockers = Array.from({ length: 4 }, () => deferred<string>());
      // Use a separate resolver call recording — same resolver is reused
      for (let i = 0; i < 4; i++) {
        q.enqueue(makeCtx({ toolCallId: `b-${i}` }), () => blockers[i].promise).catch(() => {});
      }
      await Promise.resolve();
      await Promise.resolve();

      const callsBefore = (resolver as jest.Mock).mock.calls.length;

      const waiter = q.enqueue(makeCtx({ toolCallId: 'waiter' }), async ({ authorizationHeader }) => {
        expect(authorizationHeader).toBe('Bearer abc');
        return 'ok';
      });

      const callsAfterEnqueue = (resolver as jest.Mock).mock.calls.length;
      // Resolver for the waiter must NOT have been called yet (still queued).
      expect(callsAfterEnqueue).toBe(callsBefore);

      blockers[0].resolve('ok');
      await Promise.resolve();
      await Promise.resolve();
      await waiter;

      // Now the resolver MUST have been invoked for the waiter (post-dequeue).
      const callsFinal = (resolver as jest.Mock).mock.calls.length;
      expect(callsFinal).toBeGreaterThan(callsBefore);

      for (let i = 1; i < 4; i++) blockers[i].resolve('ok');
    });
  });

  describe('FIFO ordering', () => {
    test('queued items dequeue in enqueue order', async () => {
      const q = makeQueue();
      const blockers = Array.from({ length: 4 }, () => deferred<string>());
      const blockerPromises: Promise<string>[] = [];
      for (let i = 0; i < 4; i++) {
        blockerPromises.push(
          q.enqueue(makeCtx({ toolCallId: `b-${i}` }), () => blockers[i].promise),
        );
      }
      await Promise.resolve();
      await Promise.resolve();

      const order: string[] = [];
      const waiters = ['w1', 'w2', 'w3'].map((tc) =>
        q.enqueue(makeCtx({ toolCallId: tc }), async () => {
          order.push(tc);
          return tc;
        }),
      );

      await Promise.resolve();
      await Promise.resolve();
      expect(q.snapshot().queued).toBe(3);

      // Release blockers one by one; FIFO order
      for (let i = 0; i < 4; i++) {
        blockers[i].resolve('ok');
        await blockerPromises[i];
        await Promise.resolve();
        await Promise.resolve();
      }
      await Promise.all(waiters);
      expect(order).toEqual(['w1', 'w2', 'w3']);
    });
  });

  /**
   * Step 4e MEDIUM-1 — the inner Graph timeout (30s default) is enforced
   * by the queue itself via the executor's AbortSignal, BEFORE the outer
   * MCP timeout (45s safety net) fires.
   */
  describe('inner-graph-timeout enforcement (REQ-025)', () => {
    test('inner timer aborts executor before outer timeout', async () => {
      jest.useFakeTimers();
      try {
        const q = makeQueue({
          queueWaitTimeoutMs: 100,
          innerGraphTimeoutMs: 300,
          outerTimeoutMs: 5_000,
          gracePeriodMs: 500,
        });

        let abortReason: unknown = null;
        const exec: MCPCallExecutor<string> = ({ abortSignal }) =>
          new Promise<string>((_, reject) => {
            abortSignal.addEventListener('abort', () => {
              abortReason = (abortSignal as AbortSignal & { reason?: unknown }).reason;
              reject(new Error('aborted'));
            });
          });

        const settled = q
          .enqueue(makeCtx({ toolCallId: 'inner' }), exec)
          .catch((e: unknown) => e);

        await Promise.resolve();
        await Promise.resolve();
        expect(q.inFlightCountForUser('user-a')).toBe(1);

        // Inner fires at 300ms — well before outer (5000ms).
        jest.advanceTimersByTime(310);
        await Promise.resolve();
        await Promise.resolve();

        expect(abortReason).toBeInstanceOf(Error);
        expect((abortReason as Error).message).toBe('inner_graph_timeout');

        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect(q.inFlightCountForUser('user-a')).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  /**
   * Step 4e MEDIUM-3 — the AbortSignal listener installed on the caller's
   * external signal MUST be removed on every settle path including the
   * grace-fallback path, to prevent listener accumulation under sustained
   * timed-out load.
   */
  describe('AbortSignal listener cleanup (no leak)', () => {
    test('listener removed on grace-fallback path', async () => {
      jest.useFakeTimers();
      try {
        const q = makeQueue({
          queueWaitTimeoutMs: 100,
          innerGraphTimeoutMs: 200,
          outerTimeoutMs: 1_000,
          gracePeriodMs: 200,
        });

        const externalController = new AbortController();
        const addSpy = jest.spyOn(externalController.signal, 'addEventListener');
        const removeSpy = jest.spyOn(externalController.signal, 'removeEventListener');

        const exec: MCPCallExecutor<string> = () => new Promise<string>(() => {});

        const settled = q
          .enqueue(
            makeCtx({ toolCallId: 'leaky', abortSignal: externalController.signal }),
            exec,
          )
          .catch((e: unknown) => e);

        await Promise.resolve();
        await Promise.resolve();

        // Advance past outer + grace.
        jest.advanceTimersByTime(1_300);
        await Promise.resolve();
        await Promise.resolve();

        const err = await settled;
        expect((err as Error).message).toMatch(/grace/);
        // Net listener delta should be zero on the abort event.
        const addedAbort = addSpy.mock.calls.filter((c) => c[0] === 'abort').length;
        const removedAbort = removeSpy.mock.calls.filter((c) => c[0] === 'abort').length;
        expect(removedAbort).toBeGreaterThanOrEqual(addedAbort);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  /**
   * Step 4e MEDIUM-5 — `pumpQueue` scans the whole queue rather than
   * stopping at the head item whose owner is capped, so a heavy single-user
   * cannot starve other users behind them in the global FIFO.
   */
  describe('pumpQueue head-of-line bypass (MEDIUM-5)', () => {
    test('user B with empty slots dequeues past user A who is at cap', async () => {
      const q = makeQueue();
      const blockers = Array.from({ length: 5 }, () => deferred<string>());

      // 4 in-flight for user A — fills the per-user cap.
      const aPromises: Promise<string>[] = [];
      for (let i = 0; i < 4; i++) {
        aPromises.push(
          q.enqueue(
            makeCtx({ userId: 'user-a', toolCallId: `a-${i}` }),
            () => blockers[i].promise,
          ),
        );
      }
      await Promise.resolve();
      await Promise.resolve();
      expect(q.inFlightCountForUser('user-a')).toBe(4);

      // 5th call for user A — queues (cap reached).
      const aQueued = q.enqueue(
        makeCtx({ userId: 'user-a', toolCallId: 'a-queued' }),
        () => blockers[4].promise,
      );
      aQueued.catch(() => {});
      await Promise.resolve();
      await Promise.resolve();
      expect(q.snapshot().queued).toBe(1);

      // User B enqueues a fast call — must dequeue past user A's queued head.
      let bRan = false;
      const bPromise = q.enqueue(
        makeCtx({ userId: 'user-b', conversationId: 'conv-b', toolCallId: 'b-fast' }),
        async () => {
          bRan = true;
          return 'b-done';
        },
      );

      await Promise.resolve();
      await Promise.resolve();
      const bResult = await bPromise;
      expect(bResult).toBe('b-done');
      expect(bRan).toBe(true);
      // User A's queued call must still be queued (A is still at cap).
      expect(q.snapshot().queued).toBe(1);
      expect(q.inFlightCountForUser('user-a')).toBe(4);

      // Drain.
      blockers.forEach((b) => b.resolve('ok'));
      await Promise.all([...aPromises, aQueued]);
    });
  });

  /**
   * Step 4e test-gap-1 — assert the QueueGraphTokenResolver shape (the queue's
   * resolver receives `{ userOpenIdId, scopes }` and returns a Bearer string
   * or null). The MCPManager-side adapter that wraps the legacy
   * `GraphTokenResolver` shape is covered separately in MCPManager tests; this
   * test pins the queue's contract.
   */
  describe('graphTokenResolver contract', () => {
    test('resolver receives userOpenIdId + scopes; result becomes Authorization header', async () => {
      const resolver = jest
        .fn<Promise<string | null>, [{ userOpenIdId: string; scopes: string | string[] }]>()
        .mockResolvedValue('Bearer xyz');
      const q = makeQueue({}, resolver as unknown as QueueGraphTokenResolver);

      let received: MCPCallExecutorParams | null = null;
      await q.enqueue(
        makeCtx({ userOpenIdId: 'openid-zzz', scopes: ['User.Read'], toolCallId: 'adapter' }),
        async (params) => {
          received = params;
          return 'ok';
        },
      );

      expect(resolver).toHaveBeenCalledTimes(1);
      expect(resolver).toHaveBeenCalledWith({
        userOpenIdId: 'openid-zzz',
        scopes: ['User.Read'],
      });
      expect(received).not.toBeNull();
      expect(received!.authorizationHeader).toBe('Bearer xyz');
    });
  });

  /**
   * Step 4e test-gap-2 — slot must be released even when the executor
   * throws synchronously (no `await`, no microtask boundary).
   */
  describe('slot leak on synchronous executor throw', () => {
    test('throw inside executor releases the slot', async () => {
      const q = makeQueue();
      const errPromise = q
        .enqueue(makeCtx({ toolCallId: 'sync-throw' }), (() => {
          throw new Error('boom');
        }) as unknown as MCPCallExecutor<string>)
        .catch((e: unknown) => e);

      const err = await errPromise;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('boom');
      expect(q.inFlightCountForUser('user-a')).toBe(0);
      expect(q.snapshot().inFlightUsers).toBe(0);
    });
  });
});
