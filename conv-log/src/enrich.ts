import type { EnrichInputBatch, NormalizedMessage, NormalizedConversation, NormalizedAgent, NormalizedGuardrailEvent } from './mongo.js';

// ---- Public output types ----

export type EnrichedRow = {
  readonly message_id: string;
  readonly user_id: string;
  readonly conversation_id: string | null;
  readonly parent_message_id: string | null;
  readonly sender: string | null;
  readonly endpoint: string | null;
  readonly model_or_agent_id: string | null;
  readonly is_user: boolean;
  readonly text: string | null;
  readonly content: ReadonlyArray<unknown> | null;
  readonly token_count: number | null;
  readonly error: boolean;
  readonly unfinished: boolean;
  readonly has_attachments: boolean;
  readonly has_files: boolean;
  readonly feedback_rating: string | null;
  readonly feedback_tag: unknown;
  readonly feedback_text: string | null;
  readonly source_created_at: Date;
  readonly source_updated_at: Date;
  readonly schema_version: number;
};

export type EnrichedConversation = {
  readonly conversation_id: string;
  readonly title: string | null;
  readonly agent_id: string | null;
  readonly endpoint: string | null;
  readonly user_id: string | null;
  readonly archived: boolean;
  readonly tags: string[] | null;
  readonly source_created_at: Date | null;
  readonly source_updated_at: Date | null;
  readonly dim_updated_at: Date;
  readonly schema_version: number;
};

export type EnrichedAgent = {
  readonly agent_id: string;
  readonly name: string | null;
  readonly model_underlying: string | null;
  readonly description: string | null;
  readonly last_seen_at: Date;
  readonly dim_updated_at: Date;
  readonly schema_version: number;
};

export type EnrichedGuardrailEvent = {
  readonly event_id: string;
  readonly message_id: string;
  readonly user_id: string | null;
  readonly conversation_id: string | null;
  readonly route: string | null;
  readonly entity_types: unknown;
  readonly entity_count: number | null;
  readonly source_created_at: Date | null;
};

export type EnrichedBatch = {
  readonly conversations: EnrichedConversation[];
  readonly agents: EnrichedAgent[];
  readonly messages: EnrichedRow[];
  readonly guardrailEvents: EnrichedGuardrailEvent[];
};

// ---- Private helpers ----

const flattenTextParts = (parts: ReadonlyArray<{ type: string; text?: string; [key: string]: unknown }>): string =>
  parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');

const enrichMessage = (
  msg: NormalizedMessage,
  schemaVersion: number,
): EnrichedRow => {
  const isUser = msg.isCreatedByUser;
  const hasContent = Array.isArray(msg.content) && msg.content.length > 0;

  const text = isUser
    ? (msg.text ?? null)
    : hasContent
    ? flattenTextParts(msg.content!)
    : (msg.text ?? null);

  const content = isUser ? null : (hasContent ? msg.content! : null);

  return {
    message_id: msg.messageId,
    user_id: msg.userId,
    conversation_id: msg.conversationId || null,
    parent_message_id: msg.parentMessageId,
    sender: msg.sender,
    endpoint: msg.endpoint,
    model_or_agent_id: msg.model,
    is_user: isUser,
    text,
    content: content as ReadonlyArray<unknown> | null,
    token_count: msg.tokenCount,
    error: msg.error,
    unfinished: msg.unfinished,
    has_attachments: Array.isArray(msg.attachments) && msg.attachments.length > 0,
    has_files: Array.isArray(msg.files) && msg.files.length > 0,
    feedback_rating: msg.feedback?.rating ?? null,
    feedback_tag: msg.feedback?.tag ?? null,
    feedback_text: msg.feedback?.text ?? null,
    source_created_at: msg.createdAt,
    source_updated_at: msg.updatedAt,
    schema_version: schemaVersion,
  };
};

const enrichConversation = (
  conv: NormalizedConversation,
  now: Date,
  schemaVersion: number,
): EnrichedConversation => ({
  conversation_id: conv.conversationId,
  title: conv.title,
  agent_id: conv.agentId,
  endpoint: conv.endpoint,
  user_id: conv.userId,
  archived: conv.archived,
  tags: conv.tags,
  source_created_at: conv.createdAt,
  source_updated_at: conv.updatedAt,
  dim_updated_at: now,
  schema_version: schemaVersion,
});

const enrichAgent = (
  agent: NormalizedAgent,
  now: Date,
  schemaVersion: number,
): EnrichedAgent => ({
  agent_id: agent.agentId,
  name: agent.name,
  model_underlying: agent.modelUnderlying,
  description: agent.description,
  last_seen_at: now,
  dim_updated_at: now,
  schema_version: schemaVersion,
});

const enrichGuardrailEvent = (
  evt: NormalizedGuardrailEvent,
): EnrichedGuardrailEvent => ({
  event_id: evt.eventId,
  message_id: evt.messageId,
  user_id: evt.userId,
  conversation_id: evt.conversationId,
  route: evt.route,
  entity_types: evt.entityTypes,
  entity_count: evt.entityCount,
  source_created_at: evt.createdAt,
});

// ---- Public pure function ----

/** Pure enrichment — no I/O, no Date.now() calls. Pass opts.now for determinism in tests. */
export function enrich(
  input: EnrichInputBatch,
  opts: { schemaVersion: number; now: Date },
): EnrichedBatch {
  const { schemaVersion, now } = opts;

  const conversations = [...input.conversations.values()].map((c) =>
    enrichConversation(c, now, schemaVersion),
  );

  const agents = [...input.agents.values()].map((a) =>
    enrichAgent(a, now, schemaVersion),
  );

  const messages = input.messages.map((m) => enrichMessage(m, schemaVersion));

  const guardrailEvents = input.guardrailEvents.map(enrichGuardrailEvent);

  return { conversations, agents, messages, guardrailEvents };
}
