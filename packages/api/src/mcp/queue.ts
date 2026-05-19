import { logger } from '@librechat/data-schemas';
import {
  QueueDepthExceededError,
  QueueWaitTimedOutError,
  QueueCancelledError,
} from './errorEnvelope';

/**
 * SPEC-014 REQ-024 — per-server FIFO call queue with bounded depth and
 * cascading-timeout discipline. Phase 1 instantiates this ONLY for the
 * `Microsoft365` server; other MCP servers retain their pre-SPEC-014
 * unbounded behavior.
 *
 * Public surface is intentionally small (a single `enqueue` method). All
 * slot bookkeeping, FIFO management, timeout pumping, and AbortSignal
 * chaining is hidden so callers do not need to coordinate cancellation
 * across the queue and the executor.
 *
 * The post-dequeue Graph token freshness re-check (PERF-003) is performed
 * by the injected `graphTokenResolver`: the queue calls it AFTER claiming
 * a slot, so a token refreshed at emission time accompanies the outbound
 * MCP call. The resolver may return `null` for non-Entra sessions — in
 * that case the executor receives `authorizationHeader: null` and is
 * expected to OMIT the `Authorization` header upstream so the caller can
 * surface `code: "Unauthenticated"` per the Error Response Schema.
 *
 * Singleton assumption (LOW-3): the queue's in-flight and depth bookkeeping
 * is per-instance. `MCPManager` constructs one `MCPCallQueue` per server
 * name and is itself a process-wide singleton, so per-server bounds hold.
 * If `MCPManager` is ever instantiated multiple times in the same process
 * (e.g., worker pools), the per-server caps would multiply by N — callers
 * must promote the queue map to a module-level singleton in that case.
 */

export interface MCPCallQueueOptions {
  /** Max concurrent in-flight calls per user. Spec default: 4. */
  inFlightPerUser: number;
  /** Max concurrent in-flight calls per conversation. Spec default: 8. */
  inFlightPerConversation: number;
  /** Max queued (waiting) calls per server. Spec default: 16. */
  queueDepthPerServer: number;
  /** Max queued (waiting) calls per conversation. Spec default: 32. */
  queueDepthPerConversation: number;
  /** Queue-wait timeout (ms) before emitting Throttled. Spec default: 14000. */
  queueWaitTimeoutMs: number;
  /** Outer MCP timeout (ms). Spec default: 45000. */
  outerTimeoutMs: number;
  /**
   * Inner Graph timeout (ms). Enforced by `runWithOuterTimeout`: a timer
   * fires at this bound and aborts the executor with `inner_graph_timeout`
   * BEFORE the outer 45s safety net. LibreChat owns the inner enforcement
   * — Softeria is not required to honor a separate inner-timeout flag.
   * Spec default: 30000.
   */
  innerGraphTimeoutMs: number;
  /**
   * Grace period (ms) past the outer timeout before the slot is forcibly
   * released (handles executors that ignore AbortSignal). Spec default: 5000.
   */
  gracePeriodMs: number;
}

export interface MCPCallContext {
  userId: string;
  userOpenIdId: string;
  conversationId: string;
  messageId: string;
  toolCallId: string;
  scopes: string | string[];
  /** External AbortSignal for caller-side cancellation. */
  abortSignal?: AbortSignal;
}

export interface MCPCallExecutorParams {
  /**
   * The resolved Authorization header value, or `null` when the user has
   * no Entra session. On `null`, the executor MUST omit the Authorization
   * header from the outbound MCP request entirely (do NOT emit
   * `Bearer ` with empty value).
   */
  authorizationHeader: string | null;
  /** REQ-023 correlation ID: `${conversationId}:${messageId}:${toolCallId}`. */
  correlationId: string;
  /** Combined AbortSignal (external + outer timeout). */
  abortSignal: AbortSignal;
}

export type MCPCallExecutor<TResult> = (params: MCPCallExecutorParams) => Promise<TResult>;

/**
 * Resolver responsible for producing a Graph access token at Bearer-header
 * emission time. Returns `null` when no Entra session is available (the
 * caller surfaces `Unauthenticated`).
 */
export type QueueGraphTokenResolver = (params: {
  userOpenIdId: string;
  scopes: string | string[];
}) => Promise<string | null>;

interface QueuedItem {
  callId: string;
  ctx: MCPCallContext;
  resolveSlot: () => void;
  rejectSlot: (err: Error) => void;
  enqueuedAt: number;
  cancelled: boolean;
}

/**
 * Builds the deterministic REQ-023 correlation identifier.
 */
export function buildCorrelationId(ctx: MCPCallContext): string {
  return `${ctx.conversationId}:${ctx.messageId}:${ctx.toolCallId}`;
}

/**
 * Asserts the SPEC-014 cascading-timeout invariant at construction time.
 * Throws if `queueWaitTimeoutMs + innerGraphTimeoutMs + mcpHopBudgetMs >=
 * outerTimeoutMs`. The MCP hop budget is fixed at 500ms per spec
 * REQ-025; callers may not override it.
 */
export const MCP_HOP_BUDGET_MS = 500;

export function assertCascadingTimeoutInvariant(opts: MCPCallQueueOptions): void {
  const sum = opts.queueWaitTimeoutMs + opts.innerGraphTimeoutMs + MCP_HOP_BUDGET_MS;
  if (sum >= opts.outerTimeoutMs) {
    throw new Error(
      `[MCPCallQueue] Cascading-timeout invariant violated: queue_wait_max (${opts.queueWaitTimeoutMs}) + graph_inner_timeout (${opts.innerGraphTimeoutMs}) + mcp_hop_budget (${MCP_HOP_BUDGET_MS}) = ${sum} >= outer_mcp_timeout (${opts.outerTimeoutMs}). Adjust options or revisit SPEC-014 REQ-025.`,
    );
  }
}

export class MCPCallQueue {
  private readonly serverName: string;
  private readonly opts: MCPCallQueueOptions;
  private readonly graphTokenResolver?: QueueGraphTokenResolver;

  private readonly inFlightByUser: Map<string, Set<string>> = new Map();
  private readonly inFlightByConversation: Map<string, Set<string>> = new Map();
  private readonly queue: QueuedItem[] = [];

  private callIdCounter = 0;

  constructor(
    serverName: string,
    opts: MCPCallQueueOptions,
    graphTokenResolver?: QueueGraphTokenResolver,
  ) {
    assertCascadingTimeoutInvariant(opts);
    this.serverName = serverName;
    this.opts = opts;
    this.graphTokenResolver = graphTokenResolver;
  }

  private nextCallId(): string {
    this.callIdCounter += 1;
    return `${this.serverName}:${this.callIdCounter}`;
  }

  private countQueuedForServer(): number {
    return this.queue.length;
  }

  private countQueuedForConversation(conversationId: string): number {
    let n = 0;
    for (const item of this.queue) {
      if (item.ctx.conversationId === conversationId) n += 1;
    }
    return n;
  }

  private inFlightForUser(userId: string): number {
    return this.inFlightByUser.get(userId)?.size ?? 0;
  }

  private inFlightForConversation(conversationId: string): number {
    return this.inFlightByConversation.get(conversationId)?.size ?? 0;
  }

  private canClaimSlot(ctx: MCPCallContext): boolean {
    return (
      this.inFlightForUser(ctx.userId) < this.opts.inFlightPerUser &&
      this.inFlightForConversation(ctx.conversationId) < this.opts.inFlightPerConversation
    );
  }

  private claimSlot(callId: string, ctx: MCPCallContext): void {
    let userSet = this.inFlightByUser.get(ctx.userId);
    if (!userSet) {
      userSet = new Set();
      this.inFlightByUser.set(ctx.userId, userSet);
    }
    userSet.add(callId);

    let convoSet = this.inFlightByConversation.get(ctx.conversationId);
    if (!convoSet) {
      convoSet = new Set();
      this.inFlightByConversation.set(ctx.conversationId, convoSet);
    }
    convoSet.add(callId);
  }

  private releaseSlot(callId: string, ctx: MCPCallContext): void {
    const userSet = this.inFlightByUser.get(ctx.userId);
    if (userSet) {
      userSet.delete(callId);
      if (userSet.size === 0) this.inFlightByUser.delete(ctx.userId);
    }
    const convoSet = this.inFlightByConversation.get(ctx.conversationId);
    if (convoSet) {
      convoSet.delete(callId);
      if (convoSet.size === 0) this.inFlightByConversation.delete(ctx.conversationId);
    }
    this.pumpQueue();
  }

  private pumpQueue(): void {
    /**
     * MEDIUM-5 fix — scan the entire queue head-to-tail and dequeue the
     * first item whose owner can claim a slot, rather than stopping at the
     * literal head. This eliminates the head-of-line blocking case where
     * a capped user's queued call would starve every other user behind it.
     * FIFO is preserved PER (userId, conversationId) tuple but not globally
     * — which matches REQ-024's per-user / per-conversation cap semantics.
     */
    let progressed = true;
    while (progressed && this.queue.length > 0) {
      progressed = false;
      for (let i = 0; i < this.queue.length; i++) {
        const item = this.queue[i];
        if (item.cancelled) {
          this.queue.splice(i, 1);
          i -= 1;
          progressed = true;
          continue;
        }
        if (!this.canClaimSlot(item.ctx)) continue;
        this.queue.splice(i, 1);
        this.claimSlot(item.callId, item.ctx);
        item.resolveSlot();
        progressed = true;
        break;
      }
    }
  }

  /**
   * Enqueues a Microsoft365 MCP tool call. Returns the executor's resolved
   * value or rethrows on cancellation, queue-wait timeout, capacity, or
   * executor error.
   *
   * Throws:
   * - `QueueDepthExceededError` — server- or conversation-level queue depth
   *   cap exceeded. Caller maps to `code: "Throttled"`,
   *   `throttleSource: "librechat_concurrency_cap"`.
   * - `QueueWaitTimedOutError` — slot did not free within
   *   `queueWaitTimeoutMs`. Caller maps to `code: "Throttled"`,
   *   `throttleSource: "librechat_queue"`.
   * - `QueueCancelledError` — external AbortSignal fired before dequeue.
   * - Anything thrown by the executor or the `graphTokenResolver` is
   *   propagated for the caller to map (e.g., `InvalidGraphTokenError`).
   */
  async enqueue<TResult>(
    ctx: MCPCallContext,
    executor: MCPCallExecutor<TResult>,
  ): Promise<TResult> {
    const correlationId = buildCorrelationId(ctx);
    const callId = this.nextCallId();

    if (ctx.abortSignal?.aborted) {
      logger.debug(
        `[MCP][${this.serverName}][${correlationId}] enqueue rejected — caller signal already aborted`,
      );
      throw new QueueCancelledError();
    }

    if (this.countQueuedForServer() >= this.opts.queueDepthPerServer) {
      logger.warn(
        `[MCP][${this.serverName}][${correlationId}] queue depth cap (server=${this.opts.queueDepthPerServer}) reached — failing fast`,
      );
      throw new QueueDepthExceededError(
        `Server-level queue depth (${this.opts.queueDepthPerServer}) exceeded`,
      );
    }
    if (this.countQueuedForConversation(ctx.conversationId) >= this.opts.queueDepthPerConversation) {
      logger.warn(
        `[MCP][${this.serverName}][${correlationId}] queue depth cap (conversation=${this.opts.queueDepthPerConversation}) reached — failing fast`,
      );
      throw new QueueDepthExceededError(
        `Conversation-level queue depth (${this.opts.queueDepthPerConversation}) exceeded`,
      );
    }

    logger.debug(
      `[MCP][${this.serverName}][${correlationId}] enqueue (in_flight_user=${this.inFlightForUser(
        ctx.userId,
      )}, in_flight_conv=${this.inFlightForConversation(ctx.conversationId)}, queued=${this.queue.length})`,
    );

    await this.acquireSlot(callId, ctx, correlationId);

    try {
      logger.debug(
        `[MCP][${this.serverName}][${correlationId}] dequeue — slot claimed (in_flight_user=${this.inFlightForUser(ctx.userId)})`,
      );

      const authorizationHeader = await this.resolveBearerHeader(ctx, correlationId);

      const { combinedSignal, cleanup } = this.buildExecutorSignal(ctx);
      try {
        const result = await this.runWithOuterTimeout(
          callId,
          ctx,
          executor,
          {
            authorizationHeader,
            correlationId,
            abortSignal: combinedSignal,
          },
        );
        logger.debug(`[MCP][${this.serverName}][${correlationId}] complete`);
        return result;
      } finally {
        cleanup();
      }
    } finally {
      this.releaseSlot(callId, ctx);
    }
  }

  private async resolveBearerHeader(
    ctx: MCPCallContext,
    correlationId: string,
  ): Promise<string | null> {
    if (!this.graphTokenResolver) return null;
    try {
      const header = await this.graphTokenResolver({
        userOpenIdId: ctx.userOpenIdId,
        scopes: ctx.scopes,
      });
      if (header == null) {
        logger.debug(
          `[MCP][${this.serverName}][${correlationId}] graphTokenResolver returned null — Authorization header will be omitted`,
        );
      }
      return header;
    } catch (err) {
      logger.error(
        `[MCP][${this.serverName}][${correlationId}] graphTokenResolver threw`,
        err,
      );
      throw err;
    }
  }

  private acquireSlot(
    callId: string,
    ctx: MCPCallContext,
    correlationId: string,
  ): Promise<void> {
    /**
     * LOW-2 note — the synchronous canClaimSlot/claimSlot pair below is
     * race-free under Node's single-threaded model: two concurrent
     * `enqueue` calls in the same tick serialize, so the first claims
     * the slot before the second observes the updated counts. If the
     * codebase ever moves to a worker-thread model that shares this map,
     * promote the claim path to a CAS via shared-memory atomics.
     */
    if (this.canClaimSlot(ctx)) {
      this.claimSlot(callId, ctx);
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const item: QueuedItem = {
        callId,
        ctx,
        resolveSlot: () => {
          cleanup();
          resolve();
        },
        rejectSlot: (err: Error) => {
          cleanup();
          reject(err);
        },
        enqueuedAt: Date.now(),
        cancelled: false,
      };

      const waitTimer = setTimeout(() => {
        if (item.cancelled) return;
        item.cancelled = true;
        const idx = this.queue.indexOf(item);
        if (idx >= 0) this.queue.splice(idx, 1);
        logger.warn(
          `[MCP][${this.serverName}][${correlationId}] queue-wait timeout (${this.opts.queueWaitTimeoutMs}ms) — emitting Throttled`,
        );
        item.rejectSlot(
          new QueueWaitTimedOutError(
            `Queue wait exceeded ${this.opts.queueWaitTimeoutMs}ms before slot opened`,
          ),
        );
      }, this.opts.queueWaitTimeoutMs);

      const abortListener = () => {
        if (item.cancelled) return;
        item.cancelled = true;
        const idx = this.queue.indexOf(item);
        if (idx >= 0) this.queue.splice(idx, 1);
        logger.debug(
          `[MCP][${this.serverName}][${correlationId}] queue wait cancelled by caller signal`,
        );
        item.rejectSlot(new QueueCancelledError());
      };

      const cleanup = () => {
        clearTimeout(waitTimer);
        if (ctx.abortSignal) ctx.abortSignal.removeEventListener('abort', abortListener);
      };

      if (ctx.abortSignal) ctx.abortSignal.addEventListener('abort', abortListener);

      this.queue.push(item);
    });
  }

  private buildExecutorSignal(ctx: MCPCallContext): {
    combinedSignal: AbortSignal;
    cleanup: () => void;
    abort: (reason?: unknown) => void;
  } {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(ctx.abortSignal?.reason);
    if (ctx.abortSignal) {
      if (ctx.abortSignal.aborted) controller.abort(ctx.abortSignal.reason);
      else ctx.abortSignal.addEventListener('abort', onExternalAbort);
    }
    const cleanup = () => {
      if (ctx.abortSignal) ctx.abortSignal.removeEventListener('abort', onExternalAbort);
    };
    return {
      combinedSignal: controller.signal,
      cleanup,
      abort: (reason?: unknown) => controller.abort(reason),
    };
  }

  private runWithOuterTimeout<TResult>(
    _callId: string,
    _ctx: MCPCallContext,
    executor: MCPCallExecutor<TResult>,
    execParams: MCPCallExecutorParams,
  ): Promise<TResult> {
    const correlationId = execParams.correlationId;
    const outerController = new AbortController();
    const onExecSignalAbort = () => outerController.abort(execParams.abortSignal.reason);
    /**
     * MEDIUM-3 fix — cleanup hoisted so EVERY settle path (executor
     * resolve, executor reject, inner-graph-timeout fire, outer-timeout
     * grace-fallback) removes the listener from the external AbortSignal.
     * Previously the grace-fallback path rejected without cleanup, leaking
     * one listener per timed-out call.
     */
    const cleanupAbortListener = (): void => {
      execParams.abortSignal.removeEventListener('abort', onExecSignalAbort);
    };
    if (execParams.abortSignal.aborted) outerController.abort(execParams.abortSignal.reason);
    else execParams.abortSignal.addEventListener('abort', onExecSignalAbort);

    const effectiveParams: MCPCallExecutorParams = {
      ...execParams,
      abortSignal: outerController.signal,
    };

    return new Promise<TResult>((resolve, reject) => {
      let settled = false;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;

      /**
       * MEDIUM-1 fix — inner-graph-timeout enforcement. LibreChat owns the
       * inner bound: at `innerGraphTimeoutMs` we abort the executor's
       * AbortSignal with reason `inner_graph_timeout`. The outer
       * `outerTimeoutMs` timer remains as the safety net for executors
       * that ignore abort. Order: inner (30s) -> outer (45s) -> grace (+5s).
       */
      const innerTimer = setTimeout(() => {
        if (settled) return;
        logger.warn(
          `[MCP][${this.serverName}][${correlationId}] inner Graph timeout (${this.opts.innerGraphTimeoutMs}ms) — aborting executor`,
        );
        outerController.abort(new Error('inner_graph_timeout'));
      }, this.opts.innerGraphTimeoutMs);

      const outerTimer = setTimeout(() => {
        if (settled) return;
        logger.warn(
          `[MCP][${this.serverName}][${correlationId}] outer MCP timeout (${this.opts.outerTimeoutMs}ms) — aborting executor`,
        );
        outerController.abort(new Error('outer_mcp_timeout'));
        graceTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          logger.warn(
            `[MCP][${this.serverName}][${correlationId}] grace fallback (${this.opts.gracePeriodMs}ms) — forcing slot release; late executor result will be dropped`,
          );
          clearTimeout(innerTimer);
          cleanupAbortListener();
          reject(new Error('outer_mcp_timeout_grace'));
        }, this.opts.gracePeriodMs);
      }, this.opts.outerTimeoutMs);

      const clearAllTimers = (): void => {
        clearTimeout(innerTimer);
        clearTimeout(outerTimer);
        if (graceTimer) clearTimeout(graceTimer);
      };

      executor(effectiveParams)
        .then((value) => {
          if (settled) return;
          settled = true;
          clearAllTimers();
          cleanupAbortListener();
          resolve(value);
        })
        .catch((err: unknown) => {
          if (settled) return;
          settled = true;
          clearAllTimers();
          cleanupAbortListener();
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  /** Test-only / diagnostics: snapshot of current load. */
  public snapshot(): {
    inFlightUsers: number;
    inFlightConversations: number;
    queued: number;
  } {
    return {
      inFlightUsers: this.inFlightByUser.size,
      inFlightConversations: this.inFlightByConversation.size,
      queued: this.queue.length,
    };
  }

  /** Test-only: in-flight count for a single user. */
  public inFlightCountForUser(userId: string): number {
    return this.inFlightForUser(userId);
  }
}

/**
 * Spec-default queue options for the `Microsoft365` server. Phase 1 only.
 * The cascading-timeout invariant is asserted at queue construction.
 */
export const MICROSOFT365_QUEUE_DEFAULTS: MCPCallQueueOptions = {
  inFlightPerUser: 4,
  inFlightPerConversation: 8,
  queueDepthPerServer: 16,
  queueDepthPerConversation: 32,
  queueWaitTimeoutMs: 14_000,
  outerTimeoutMs: 45_000,
  innerGraphTimeoutMs: 30_000,
  gracePeriodMs: 5_000,
};
