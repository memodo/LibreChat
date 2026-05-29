import { MongoClient } from 'mongodb';
import { LRUCache } from 'lru-cache';
import type { Document, WithId } from 'mongodb';

export type { MongoClient };

// ---- Internal raw document shapes (private to this module) ----
// These mirror the LibreChat Mongo collection shapes as of 2026-05-26.
// Do NOT export — the module boundary exposes only normalised types.

type RawContentPart = {
  type: string;
  text?: string;
  [key: string]: unknown;
};

type RawFeedback = {
  rating?: string;
  tag?: unknown;
  text?: string;
};

type RawMessage = {
  _id: unknown;
  messageId: string;
  conversationId: string;
  user: string;
  parentMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
  endpoint?: string;
  sender?: string;
  text?: string;
  tokenCount?: number;
  isCreatedByUser?: boolean;
  error?: boolean;
  unfinished?: boolean;
  model?: string;
  content?: RawContentPart[];
  attachments?: unknown[];
  files?: unknown[];
  feedback?: RawFeedback;
  tenantId?: null;
};

type RawConversation = {
  _id: unknown;
  conversationId: string;
  title?: string;
  agentId?: string;
  endpoint?: string;
  user?: string;
  archived?: boolean;
  tags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
};

type RawAgent = {
  _id: unknown;
  id: string;
  name?: string;
  model?: string;
  description?: string;
};

type RawGuardrailDetails = {
  entityTypes?: unknown;
  entityCount?: number;
  message?: string;
};

type RawGuardrailEvent = {
  _id: unknown;
  messageId?: string;
  user?: unknown;
  conversationId?: string;
  route?: string;
  guardrailType?: string;
  action?: string;
  severity?: string;
  details?: RawGuardrailDetails;
  createdAt?: Date;
};

// ---- Normalised types (exported — safe across module boundary, no driver types) ----

export type NormalizedMessage = {
  readonly messageId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly parentMessageId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly endpoint: string | null;
  readonly sender: string | null;
  readonly text: string | null;
  readonly tokenCount: number | null;
  readonly isCreatedByUser: boolean;
  readonly error: boolean;
  readonly unfinished: boolean;
  readonly model: string | null;
  readonly content: ReadonlyArray<{ type: string; text?: string; [key: string]: unknown }> | null;
  readonly attachments: ReadonlyArray<unknown> | null;
  readonly files: ReadonlyArray<unknown> | null;
  readonly feedback: { rating?: string; tag?: unknown; text?: string } | null;
};

export type NormalizedConversation = {
  readonly conversationId: string;
  readonly title: string | null;
  readonly agentId: string | null;
  readonly endpoint: string | null;
  readonly userId: string | null;
  readonly archived: boolean;
  readonly tags: string[] | null;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
};

export type NormalizedAgent = {
  readonly agentId: string;
  readonly name: string | null;
  // Stored as model_underlying in agents_dim — the rename is intentional and documented
  // in docs/field-mapping.md to prevent confusion with messages_log.model_or_agent_id.
  readonly modelUnderlying: string | null;
  readonly description: string | null;
};

export type NormalizedGuardrailEvent = {
  readonly eventId: string;
  readonly messageId: string;
  readonly userId: string | null;
  readonly conversationId: string | null;
  readonly route: string | null;
  readonly entityTypes: unknown;
  readonly entityCount: number | null;
  readonly createdAt: Date | null;
};

export type EnrichInputBatch = {
  readonly messages: NormalizedMessage[];
  readonly conversations: Map<string, NormalizedConversation>;
  readonly agents: Map<string, NormalizedAgent>;
  readonly guardrailEvents: NormalizedGuardrailEvent[];
};

// ---- Guardrail collection name (CRI-10) ----
// Single point of change if the collection name differs from the Mongoose default.
// Pre-deployment operator check: mongosh '<MONGO_URI>' --eval
//   'db.getCollectionNames().filter(n => n.toLowerCase().includes("guardrail"))'
// If the result is not ['guardrailevents'], update this constant and redeploy.
export const GUARDRAIL_COLLECTION = 'guardrailevents';

// ---- LRU cache (module-level private state, configured once) ----

let convCache: LRUCache<string, NormalizedConversation> = new LRUCache({ max: 1000, ttl: 3600 * 1000 });
let agentCache: LRUCache<string, NormalizedAgent> = new LRUCache({ max: 1000, ttl: 3600 * 1000 });

export function configureCache(opts: { capacity: number; ttlSeconds: number }): void {
  convCache = new LRUCache({ max: opts.capacity, ttl: opts.ttlSeconds * 1000 });
  agentCache = new LRUCache({ max: opts.capacity, ttl: opts.ttlSeconds * 1000 });
}

// ---- Client factory ----

export function createMongoClient(uri: string, options?: { queryTimeoutMs: number }): MongoClient {
  const timeout = options?.queryTimeoutMs ?? 30000;
  return new MongoClient(uri, {
    serverSelectionTimeoutMS: timeout,
    socketTimeoutMS: timeout,
  });
}

// ---- Normalisation helpers (private) ----

// CRI-15 (defensive normalization): returns null if the document is malformed
// in a way that would pollute the analytical store (missing messageId or invalid date).
// Callers must filter out null entries before processing.
const normaliseMessage = (doc: WithId<Document>): NormalizedMessage | null => {
  // Validate messageId — must be a non-empty string.
  const messageId = String(doc['messageId'] ?? '');
  if (messageId === '') {
    return null;
  }

  // Validate createdAt — must yield a valid Date.
  const createdAt = doc['createdAt'] instanceof Date
    ? doc['createdAt']
    : new Date(doc['createdAt'] as string);
  if (isNaN(createdAt.getTime())) {
    return null;
  }

  return {
    messageId,
    conversationId: String(doc['conversationId'] ?? ''),
    userId: String(doc['user'] ?? ''),
    parentMessageId: doc['parentMessageId'] != null ? String(doc['parentMessageId']) : null,
    createdAt,
    updatedAt: doc['updatedAt'] instanceof Date ? doc['updatedAt'] : new Date(doc['updatedAt'] as string),
    endpoint: doc['endpoint'] != null ? String(doc['endpoint']) : null,
    sender: doc['sender'] != null ? String(doc['sender']) : null,
    text: doc['text'] != null ? String(doc['text']) : null,
    tokenCount: doc['tokenCount'] != null ? Number(doc['tokenCount']) : null,
    isCreatedByUser: Boolean(doc['isCreatedByUser']),
    error: Boolean(doc['error']),
    unfinished: Boolean(doc['unfinished']),
    model: doc['model'] != null ? String(doc['model']) : null,
    content: Array.isArray(doc['content']) ? (doc['content'] as RawContentPart[]) : null,
    attachments: Array.isArray(doc['attachments']) ? (doc['attachments'] as unknown[]) : null,
    files: Array.isArray(doc['files']) ? (doc['files'] as unknown[]) : null,
    feedback: doc['feedback'] != null ? (doc['feedback'] as RawFeedback) : null,
  };
};

const normaliseConversation = (doc: WithId<Document>): NormalizedConversation => ({
  conversationId: String(doc['conversationId'] ?? ''),
  title: doc['title'] != null ? String(doc['title']) : null,
  agentId: doc['agentId'] != null ? String(doc['agentId']) : null,
  endpoint: doc['endpoint'] != null ? String(doc['endpoint']) : null,
  userId: doc['user'] != null ? String(doc['user']) : null,
  archived: Boolean(doc['archived']),
  tags: Array.isArray(doc['tags']) ? (doc['tags'] as string[]) : null,
  createdAt: doc['createdAt'] instanceof Date ? doc['createdAt'] : (doc['createdAt'] != null ? new Date(doc['createdAt'] as string) : null),
  updatedAt: doc['updatedAt'] instanceof Date ? doc['updatedAt'] : (doc['updatedAt'] != null ? new Date(doc['updatedAt'] as string) : null),
});

const normaliseAgent = (doc: WithId<Document>): NormalizedAgent => ({
  agentId: String(doc['id'] ?? ''),
  name: doc['name'] != null ? String(doc['name']) : null,
  modelUnderlying: doc['model'] != null ? String(doc['model']) : null,
  description: doc['description'] != null ? String(doc['description']) : null,
});

const normaliseGuardrailEvent = (doc: WithId<Document>): NormalizedGuardrailEvent => {
  const details = (doc['details'] ?? {}) as RawGuardrailDetails;
  return {
    eventId: String(doc['_id']),
    messageId: String(doc['messageId'] ?? ''),
    userId: doc['user'] != null ? String(doc['user']) : null,
    conversationId: doc['conversationId'] != null ? String(doc['conversationId']) : null,
    route: doc['route'] != null ? String(doc['route']) : null,
    entityTypes: details.entityTypes ?? null,
    entityCount: details.entityCount != null ? Number(details.entityCount) : null,
    createdAt: doc['createdAt'] instanceof Date ? doc['createdAt'] : (doc['createdAt'] != null ? new Date(doc['createdAt'] as string) : null),
  };
};

// ---- Public fetch functions ----

export async function fetchMessageBatch(
  client: MongoClient,
  watermark: Date,
  batchSize: number,
  timeoutMs: number,
  onNormalisationSkip?: (docId: string) => void,
): Promise<NormalizedMessage[]> {
  const docs = await client
    .db('LibreChat')
    .collection('messages')
    .find(
      { createdAt: { $gt: watermark } },
      { sort: { createdAt: 1 }, limit: batchSize, maxTimeMS: timeoutMs },
    )
    .toArray();

  const results: NormalizedMessage[] = [];
  for (const doc of docs) {
    const normalised = normaliseMessage(doc);
    if (normalised === null) {
      // Malformed doc — skip and notify caller so it can increment metrics/log.
      const docId = doc['_id'] != null ? String(doc['_id']) : '(unknown)';
      onNormalisationSkip?.(docId);
      continue;
    }
    results.push(normalised);
  }
  return results;
}

export async function lookupConversation(
  client: MongoClient,
  conversationId: string,
): Promise<NormalizedConversation | null> {
  const cached = convCache.get(conversationId);
  if (cached != null) return cached;

  const doc = await client
    .db('LibreChat')
    .collection('conversations')
    .findOne({ conversationId }, { maxTimeMS: 10000 });

  if (doc == null) return null;
  const normalised = normaliseConversation(doc);
  convCache.set(conversationId, normalised);
  return normalised;
}

export async function lookupAgent(
  client: MongoClient,
  agentId: string,
): Promise<NormalizedAgent | null> {
  const cached = agentCache.get(agentId);
  if (cached != null) return cached;

  // agent_id is stored as the string field `id` in the agents collection
  const doc = await client
    .db('LibreChat')
    .collection('agents')
    .findOne({ id: agentId }, { maxTimeMS: 10000 });

  if (doc == null) return null;
  const normalised = normaliseAgent(doc);
  agentCache.set(agentId, normalised);
  return normalised;
}

export async function fetchGuardrailEvents(
  client: MongoClient,
  messageIds: string[],
): Promise<NormalizedGuardrailEvent[]> {
  if (messageIds.length === 0) return [];
  // CRI-10: use the exported GUARDRAIL_COLLECTION constant for a single point of change.
  // Verify collection name before deploying: see GUARDRAIL_COLLECTION comment above.
  const docs = await client
    .db('LibreChat')
    .collection(GUARDRAIL_COLLECTION)
    .find({ messageId: { $in: messageIds } })
    .toArray();
  return docs.map(normaliseGuardrailEvent);
}

export async function countPendingMessages(client: MongoClient, watermark: Date): Promise<number> {
  return client
    .db('LibreChat')
    .collection('messages')
    .countDocuments({ createdAt: { $gt: watermark } });
}

// ---- Batch assembly ----

export async function assembleBatch(
  client: MongoClient,
  watermark: Date,
  batchSize: number,
  timeoutMs: number,
  onNormalisationSkip?: (docId: string) => void,
): Promise<EnrichInputBatch> {
  const messages = await fetchMessageBatch(client, watermark, batchSize, timeoutMs, onNormalisationSkip);

  const conversationIds = [...new Set(messages.map((m) => m.conversationId))];
  const messageIds = messages.map((m) => m.messageId);

  const [conversationEntries, guardrailEvents] = await Promise.all([
    Promise.all(
      conversationIds.map(async (id) => {
        const conv = await lookupConversation(client, id);
        return [id, conv] as const;
      }),
    ),
    fetchGuardrailEvents(client, messageIds),
  ]);

  const conversations = new Map<string, NormalizedConversation>(
    conversationEntries.flatMap(([id, conv]) => (conv != null ? [[id, conv]] : [])),
  );

  // Collect agent IDs for messages with endpoint === 'agents' and a model that looks like an agent ID
  const agentIds = [
    ...new Set(
      messages
        .filter((m) => m.endpoint === 'agents' && m.model != null)
        .map((m) => m.model as string),
    ),
  ];

  const agentEntries = await Promise.all(
    agentIds.map(async (id) => {
      const agent = await lookupAgent(client, id);
      return [id, agent] as const;
    }),
  );

  const agents = new Map<string, NormalizedAgent>(
    agentEntries.flatMap(([id, agent]) => (agent != null ? [[id, agent]] : [])),
  );

  return { messages, conversations, agents, guardrailEvents };
}

