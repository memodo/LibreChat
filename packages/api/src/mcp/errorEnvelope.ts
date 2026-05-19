/**
 * SPEC-014 Error Response Schema for `Microsoft365` MCP tool failures.
 *
 * All Microsoft365 tool failures surface to the agent as MCP `tools/call`
 * results with `isError: true` carried as a SIBLING of `content`. The
 * structured fields are stringified JSON inside `content[0].text` so the
 * result parses identically across MCP client SDK versions.
 *
 * `schemaVersion` is always the FIRST field of the JSON blob. The eight
 * canonical `code` values below have STABLE retry semantics; adding new
 * values is allowed in any minor spec amendment (open enum) but changing
 * the retry classification of an existing value is a breaking change.
 */

export type ErrorCode =
  | 'Unauthenticated'
  | 'InvalidToken'
  | 'InsufficientScope'
  | 'WriteForbidden'
  | 'Throttled'
  | 'UpstreamUnavailable'
  | 'SidecarUnavailable'
  | 'ProtocolMismatch';

export type ThrottleSource = 'graph_429' | 'librechat_queue' | 'librechat_concurrency_cap';

export interface ErrorEnvelope {
  schemaVersion: 1;
  code: ErrorCode;
  message: string;
  correlationId?: string;
  retryAfter?: number;
  throttleSource?: ThrottleSource;
  graphCode?: string;
  graphMessage?: string;
}

const ENVELOPE_SCHEMA_VERSION = 1 as const;

function build(envelope: Omit<ErrorEnvelope, 'schemaVersion'>): ErrorEnvelope {
  return { schemaVersion: ENVELOPE_SCHEMA_VERSION, ...envelope };
}

export function unauthenticatedError(correlationId?: string): ErrorEnvelope {
  return build({
    code: 'Unauthenticated',
    message:
      'No Microsoft Entra session for this request. The Authorization header was omitted and the upstream rejected the call.',
    correlationId,
  });
}

export function invalidTokenError(invariantFailed: string, correlationId?: string): ErrorEnvelope {
  return build({
    code: 'InvalidToken',
    message: `Graph access token failed invariant check (${invariantFailed}); header emission aborted.`,
    correlationId,
  });
}

export function insufficientScopeError(
  graphCode?: string,
  correlationId?: string,
): ErrorEnvelope {
  return build({
    code: 'InsufficientScope',
    message:
      'Microsoft Graph denied the request due to insufficient consented scopes for this user.',
    correlationId,
    graphCode,
  });
}

export function writeForbiddenError(correlationId?: string): ErrorEnvelope {
  return build({
    code: 'WriteForbidden',
    message:
      'Phase-1 Microsoft365 integration is read-only; write attempts are blocked at the Graph API.',
    correlationId,
  });
}

export function throttledByQueue(retryAfter: number, correlationId?: string): ErrorEnvelope {
  return build({
    code: 'Throttled',
    message: 'LibreChat MCP queue-wait timeout fired before a slot opened; please retry shortly.',
    correlationId,
    retryAfter,
    throttleSource: 'librechat_queue',
  });
}

export function throttledByCapacity(retryAfter: number, correlationId?: string): ErrorEnvelope {
  return build({
    code: 'Throttled',
    message:
      'LibreChat MCP concurrency cap reached for this user; queue is full. Please retry shortly.',
    correlationId,
    retryAfter,
    throttleSource: 'librechat_concurrency_cap',
  });
}

export function throttledByGraph429(
  retryAfter: number,
  graphMessage?: string,
  correlationId?: string,
): ErrorEnvelope {
  return build({
    code: 'Throttled',
    message: 'Microsoft Graph returned 429 Too Many Requests.',
    correlationId,
    retryAfter,
    throttleSource: 'graph_429',
    graphCode: 'TooManyRequests',
    graphMessage,
  });
}

export function upstreamUnavailable(
  graphCode?: string,
  graphMessage?: string,
  correlationId?: string,
): ErrorEnvelope {
  return build({
    code: 'UpstreamUnavailable',
    message: 'Microsoft Graph returned an error or was unreachable within the timeout budget.',
    correlationId,
    graphCode,
    graphMessage,
  });
}

export function sidecarUnavailable(correlationId?: string): ErrorEnvelope {
  return build({
    code: 'SidecarUnavailable',
    message:
      'The Microsoft365 MCP sidecar (mcp-m365) is unreachable; transport error or circuit breaker tripped.',
    correlationId,
  });
}

export function protocolMismatch(
  expected: string,
  advertised: string,
  correlationId?: string,
): ErrorEnvelope {
  return build({
    code: 'ProtocolMismatch',
    message: `MCP protocol version mismatch: expected ${expected}, sidecar advertised ${advertised}.`,
    correlationId,
  });
}

export interface SerializedMCPError {
  isError: true;
  content: [{ type: 'text'; text: string }];
}

/**
 * Serializes an `ErrorEnvelope` into the MCP tool-result wire shape per spec
 * Error Response Schema. `isError` is a sibling of `content`; the canonical
 * JSON blob (with `schemaVersion` as the FIRST field) is the text of the
 * single text-typed content item.
 */
export function serializeForMCP(envelope: ErrorEnvelope): SerializedMCPError {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}

/**
 * Internal error classes thrown by `MCPCallQueue` and translated to error
 * envelopes by the calling layer. Distinct from `ErrorEnvelope` so the queue
 * remains framework-agnostic.
 */
export class QueueDepthExceededError extends Error {
  constructor(message = 'Queue depth cap exceeded') {
    super(message);
    this.name = 'QueueDepthExceededError';
  }
}

export class QueueWaitTimedOutError extends Error {
  constructor(message = 'Queue wait timed out before a slot opened') {
    super(message);
    this.name = 'QueueWaitTimedOutError';
  }
}

export class QueueCancelledError extends Error {
  constructor(message = 'Queue call cancelled by caller') {
    super(message);
    this.name = 'QueueCancelledError';
  }
}

export class ProtocolMismatchError extends Error {
  public readonly expected: string;
  public readonly advertised: string;
  constructor(expected: string, advertised: string) {
    super(`MCP protocol mismatch: expected ${expected}, advertised ${advertised}`);
    this.name = 'ProtocolMismatchError';
    this.expected = expected;
    this.advertised = advertised;
  }
}

/**
 * SPEC-014 REQ-023 — thrown by `MCPManager.callTool` when a required call-
 * context field (`userId`, `conversationId`, or `messageId`) is missing from
 * the request body. Replaces the old `'unknown'` fall-through which collided
 * correlation IDs across users and undermined the REQ-024 per-user cap.
 *
 * Mapped to `code: "UpstreamUnavailable"` by the caller layer; the missing
 * field is reported in the envelope `message` so operators can trace the
 * source. `toolCallId` is NOT covered here — MCP does not always supply one,
 * and the existing `${toolName}-${Date.now()}` fallback is retained.
 */
export class MissingCallContextError extends Error {
  public readonly field: 'userId' | 'conversationId' | 'messageId';
  constructor(field: 'userId' | 'conversationId' | 'messageId') {
    super(`Missing call context: ${field}`);
    this.name = 'MissingCallContextError';
    this.field = field;
  }
}
