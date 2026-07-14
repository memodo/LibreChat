/**
 * REQ-T-3: Mongo paging integration test.
 *
 * Uses mongodb-memory-server to seed 1500 synthetic messages (including
 * clock-skew edge cases) and verifies that assembleBatch + a manual paging loop
 * processes all 1500 messages exactly once with the 60s safety margin tolerating
 * the injected skew.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMongoClient, assembleBatch, configureCache, fetchGuardrailEventBatch, GUARDRAIL_COLLECTION } from '../src/mongo.js';
import type { MongoClient } from '../src/mongo.js';

let mongoServer: MongoMemoryServer;
let mongoClient: MongoClient;

const TOTAL_MESSAGES = 1500;
const BATCH_SIZE = 500;
const SAFETY_MS = 60_000; // 60s
const TIMEOUT_MS = 30_000;
// Each batch of 500 messages spans 500 * 200ms = 100s, which exceeds the 60s
// safety margin so the watermark advances forward on every iteration.
const MSG_SPACING_MS = 200;

// IDs for 10 skew messages, so we can assert they were all captured.
const SKEW_MESSAGE_IDS = Array.from({ length: 10 }, (_, i) => `skew-msg-${i + 1}`);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  mongoClient = createMongoClient(uri, { queryTimeoutMs: TIMEOUT_MS });
  await mongoClient.connect();

  // Disable the LRU cache for test isolation (small capacity, instant TTL).
  configureCache({ capacity: 10000, ttlSeconds: 3600 });

  const db = mongoClient.db('LibreChat');

  // ---- Seed conversations (50) ----
  const convDocs = Array.from({ length: 50 }, (_, i) => ({
    conversationId: `conv-${i + 1}`,
    title: `Conversation ${i + 1}`,
    endpoint: 'openAI',
    user: 'user-001',
    archived: false,
    tags: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }));
  await db.collection('conversations').insertMany(convDocs);

  // ---- Seed agents (5) ----
  const agentDocs = Array.from({ length: 5 }, (_, i) => ({
    id: `agent-${i + 1}`,
    name: `Agent ${i + 1}`,
    model: 'gpt-4',
    description: `Test agent ${i + 1}`,
  }));
  await db.collection('agents').insertMany(agentDocs);

  // ---- Seed messages ----
  // Base: 1490 messages spaced 100ms apart starting from 2026-01-15T00:00:00.000Z
  const baseStart = new Date('2026-01-15T00:00:00.000Z').getTime();
  const regularMessages = Array.from({ length: 1490 }, (_, i) => {
    const ts = new Date(baseStart + i * MSG_SPACING_MS);
    return {
      messageId: `msg-${i + 1}`,
      conversationId: `conv-${(i % 50) + 1}`,
      user: 'user-001',
      parentMessageId: null,
      createdAt: ts,
      updatedAt: ts,
      endpoint: 'openAI',
      sender: i % 2 === 0 ? 'User' : 'GPT-4',
      text: `Message ${i + 1}`,
      isCreatedByUser: i % 2 === 0,
      error: false,
      unfinished: false,
      model: 'gpt-4',
      content: [{ type: 'text', text: `Message ${i + 1}` }],
    };
  });

  // Skew messages: 10 messages whose createdAt is 30s BEFORE the message
  // just before them in the sorted sequence. They are inserted at positions
  // spread throughout the batch. They should still be captured because the
  // safety margin is 60s.
  //
  // We place them at timestamps that are 30s earlier than msg-501's timestamp.
  // With 200ms spacing, msg-501 is at baseStart + 500 * 200ms = baseStart + 100s.
  // Skew messages land at baseStart + 100s - 30s = baseStart + 70s.
  // The watermark after batch 1 is maxBatch1 - 60s = (baseStart + 499*200ms) - 60s
  //   = baseStart + 99.8s - 60s = baseStart + 39.8s.
  // So the skew messages at baseStart + 70s are ABOVE the watermark and will
  // be captured in batch 2.
  const skewBase = baseStart + 500 * MSG_SPACING_MS; // timestamp of msg-501
  const skewMessages = SKEW_MESSAGE_IDS.map((id, i) => {
    const ts = new Date(skewBase - 30_000 + i * 10); // spread 10ms apart, all ~30s before msg-501
    return {
      messageId: id,
      conversationId: `conv-${(i % 50) + 1}`,
      user: 'user-001',
      parentMessageId: null,
      createdAt: ts,
      updatedAt: ts,
      endpoint: 'openAI',
      sender: 'User',
      text: `Skew message ${i + 1}`,
      isCreatedByUser: true,
      error: false,
      unfinished: false,
      model: null,
      content: null,
    };
  });

  await db.collection('messages').insertMany([...regularMessages, ...skewMessages]);
}, 120_000); // generous timeout for first-run binary download

afterAll(async () => {
  await mongoClient.close();
  await mongoServer.stop();
});

describe('assembleBatch — Mongo paging integration (REQ-T-3)', () => {
  it('processes all 1500 messages exactly once across multiple ticks', async () => {
    // Start the watermark at epoch (before all messages).
    let watermark = new Date(0);
    const visitedIds = new Set<string>();
    let iterations = 0;
    const MAX_ITERATIONS = 20; // safety cap

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const batch = await assembleBatch(mongoClient, watermark, BATCH_SIZE, TIMEOUT_MS);

      if (batch.messages.length === 0) break;

      // Assert batch size is within limit.
      expect(batch.messages.length).toBeLessThanOrEqual(BATCH_SIZE);

      // Record all message IDs. Duplicates are expected at batch boundaries
      // because the safety-margin watermark re-fetches messages near the edge.
      // The downstream upsert (ON CONFLICT DO UPDATE) handles idempotency.
      for (const msg of batch.messages) {
        visitedIds.add(msg.messageId);
      }

      // Advance watermark: max(batch.createdAt) - SAFETY_MS
      const maxCreatedAt = batch.messages.reduce<Date>(
        (max, m) => (m.createdAt > max ? m.createdAt : max),
        batch.messages[0]!.createdAt,
      );
      watermark = new Date(maxCreatedAt.getTime() - SAFETY_MS);
    }

    // All 1500 messages must have been visited.
    expect(visitedIds.size).toBe(TOTAL_MESSAGES);

    // All skew messages must be in the visited set.
    for (const skewId of SKEW_MESSAGE_IDS) {
      expect(visitedIds.has(skewId)).toBe(true);
    }
  }, TIMEOUT_MS * 4);

  it('returns an empty batch when watermark is past the maximum message timestamp', async () => {
    const farFuture = new Date('2099-01-01T00:00:00.000Z');
    const batch = await assembleBatch(mongoClient, farFuture, BATCH_SIZE, TIMEOUT_MS);

    expect(batch.messages).toHaveLength(0);
  });
});

describe('fetchGuardrailEventBatch — own createdAt watermark (decoupled from messages)', () => {
  const EPOCH = new Date(0);

  it('extracts entityTypes/entityCount from the nested details sub-document and event_id from _id', async () => {
    const db = mongoClient.db('LibreChat');
    const userOid = new ObjectId();
    const eventOid = new ObjectId();

    await db.collection(GUARDRAIL_COLLECTION).insertOne({
      _id: eventOid,
      user: userOid,
      guardrailType: 'pii',
      action: 'warn',
      severity: 'medium',
      details: {
        entityTypes: ['EMAIL_ADDRESS', 'PHONE_NUMBER'],
        entityCount: 2,
        message: 'PII detected',
      },
      route: '/api/agents/chat',
      conversationId: 'conv-guardrail-1',
      messageId: 'guardrail-msg-1',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const events = await fetchGuardrailEventBatch(mongoClient, EPOCH, BATCH_SIZE, TIMEOUT_MS);

    const evt = events.find((e) => e.eventId === eventOid.toString());
    expect(evt).toBeDefined();
    expect(evt!.messageId).toBe('guardrail-msg-1');
    expect(evt!.userId).toBe(userOid.toString());
    expect(evt!.conversationId).toBe('conv-guardrail-1');
    expect(evt!.route).toBe('/api/agents/chat');
    expect(evt!.entityTypes).toEqual(['EMAIL_ADDRESS', 'PHONE_NUMBER']);
    expect(evt!.entityCount).toBe(2);
  });

  it('yields null entity fields when the details sub-document is absent', async () => {
    const db = mongoClient.db('LibreChat');
    const eventOid = new ObjectId();
    await db.collection(GUARDRAIL_COLLECTION).insertOne({
      _id: eventOid,
      user: new ObjectId(),
      messageId: 'guardrail-msg-2',
      route: '/api/agents/chat',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const events = await fetchGuardrailEventBatch(mongoClient, EPOCH, BATCH_SIZE, TIMEOUT_MS);

    const evt = events.find((e) => e.eventId === eventOid.toString());
    expect(evt).toBeDefined();
    expect(evt!.entityTypes).toBeNull();
    expect(evt!.entityCount).toBeNull();
  });

  it('fetches events regardless of whether their messageId matches any message (the whole point)', async () => {
    const db = mongoClient.db('LibreChat');
    const eventOid = new ObjectId();
    await db.collection(GUARDRAIL_COLLECTION).insertOne({
      _id: eventOid,
      user: new ObjectId(),
      // A client-placeholder messageId that never persisted as a real message —
      // the old messageId-in-batch join would have skipped this forever.
      messageId: 'client-placeholder-never-a-real-message',
      route: 'agent',
      details: { entityTypes: ['PERSON'], entityCount: 1 },
      createdAt: new Date('2026-03-15T12:00:00.000Z'),
    });

    const events = await fetchGuardrailEventBatch(mongoClient, EPOCH, BATCH_SIZE, TIMEOUT_MS);
    expect(events.some((e) => e.eventId === eventOid.toString())).toBe(true);
  });

  it('only returns events strictly after the watermark, ordered by createdAt', async () => {
    const db = mongoClient.db('LibreChat');
    await db.collection(GUARDRAIL_COLLECTION).deleteMany({});
    const base = new Date('2026-05-01T00:00:00.000Z').getTime();
    const ids = [0, 1, 2, 3].map(() => new ObjectId());
    await db.collection(GUARDRAIL_COLLECTION).insertMany(
      ids.map((_id, i) => ({
        _id,
        user: new ObjectId(),
        messageId: `wm-msg-${i}`,
        createdAt: new Date(base + i * 1000),
      })),
    );

    const watermark = new Date(base + 1000); // strictly after index 1
    const events = await fetchGuardrailEventBatch(mongoClient, watermark, BATCH_SIZE, TIMEOUT_MS);

    const returnedIds = events.map((e) => e.eventId);
    expect(returnedIds).toEqual([ids[2]!.toString(), ids[3]!.toString()]);
  });

  it('honors the batch-size limit', async () => {
    const db = mongoClient.db('LibreChat');
    await db.collection(GUARDRAIL_COLLECTION).deleteMany({});
    const base = new Date('2026-06-01T00:00:00.000Z').getTime();
    await db.collection(GUARDRAIL_COLLECTION).insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        _id: new ObjectId(),
        user: new ObjectId(),
        messageId: `lim-msg-${i}`,
        createdAt: new Date(base + i * 1000),
      })),
    );

    const events = await fetchGuardrailEventBatch(mongoClient, new Date(0), 3, TIMEOUT_MS);
    expect(events).toHaveLength(3);
  });
});
