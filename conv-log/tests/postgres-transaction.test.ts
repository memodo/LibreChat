/**
 * REQ-T-4: Transactional watermark guarantee.
 *
 * Uses testcontainers Postgres. Verifies that when upsertBatch succeeds but
 * a synthetic error is thrown inside the same transaction before commit,
 * withTransaction issues ROLLBACK, and:
 *   - messages_log contains no rows for the test conversation
 *   - sync_state.messages_high_watermark is unchanged from its pre-test value
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pino } from 'pino';
import {
  createPgClient,
  connectPgClient,
  runMigrations,
  withTransaction,
  upsertBatch,
  upsertGuardrailEvents,
  runErasureReconciliation,
} from '../src/postgres.js';
import { createMongoClient } from '../src/mongo.js';
import type { MongoClient } from '../src/mongo.js';
import {
  readWatermark,
  advanceWatermark,
  MESSAGE_WATERMARK_KEY,
  MESSAGE_STATUS_KEY,
  GUARDRAIL_WATERMARK_KEY,
  GUARDRAIL_STATUS_KEY,
} from '../src/watermark.js';
import type { EnrichedBatch, EnrichedRow, EnrichedConversation, EnrichedGuardrailEvent } from '../src/enrich.js';

const MESSAGE_WATERMARK_KEYS = { watermarkKey: MESSAGE_WATERMARK_KEY, statusKey: MESSAGE_STATUS_KEY };
const GUARDRAIL_WATERMARK_KEYS = { watermarkKey: GUARDRAIL_WATERMARK_KEY, statusKey: GUARDRAIL_STATUS_KEY };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

const PG_USER = 'testuser';
const PG_PASSWORD = 'testpass';
const PG_DB = 'testdb';

let container: StartedTestContainer;
let client: pg.Client;
let mongoServer: MongoMemoryServer;
let mongoClient: MongoClient;

const silentLogger = pino({ level: 'silent' });

// ---- Fixture helpers ----

const NOW = new Date('2026-03-01T10:00:00.000Z');
const MSG_TS = new Date('2026-03-01T09:00:00.000Z');
const CONV_ID = 'conv-txn-test-001';
const USER_ID = 'user-txn-001';

function makeRow(overrides: Partial<EnrichedRow> = {}): EnrichedRow {
  return {
    message_id: `msg-txn-${Math.random().toString(36).slice(2, 9)}`,
    user_id: USER_ID,
    conversation_id: CONV_ID,
    parent_message_id: null,
    sender: 'User',
    endpoint: 'openAI',
    model_or_agent_id: null,
    is_user: true,
    text: 'Transaction test message',
    content: null,
    token_count: null,
    error: false,
    unfinished: false,
    has_attachments: false,
    has_files: false,
    feedback_rating: null,
    feedback_tag: null,
    feedback_text: null,
    source_created_at: MSG_TS,
    source_updated_at: MSG_TS,
    schema_version: 1,
    ...overrides,
  };
}

function makeConv(): EnrichedConversation {
  return {
    conversation_id: CONV_ID,
    title: 'Transaction test conversation',
    agent_id: null,
    endpoint: 'openAI',
    user_id: USER_ID,
    archived: false,
    tags: null,
    source_created_at: MSG_TS,
    source_updated_at: MSG_TS,
    dim_updated_at: NOW,
    schema_version: 1,
  };
}

function makeBatch(rows: EnrichedRow[]): EnrichedBatch {
  return {
    messages: rows,
    conversations: [makeConv()],
    agents: [],
  };
}

beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: PG_USER,
      POSTGRES_PASSWORD: PG_PASSWORD,
      POSTGRES_DB: PG_DB,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const uri = `postgresql://${PG_USER}:${PG_PASSWORD}@${host}:${port}/${PG_DB}`;
  client = createPgClient(uri, 60000);

  // Retry connecting: forListeningPorts fires when TCP is open but Postgres
  // may not yet be accepting queries. Retry up to 10 times with 500ms delay.
  let connected = false;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await connectPgClient(client);
      connected = true;
      break;
    } catch (err) {
      if (attempt === 10) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
      // Create a fresh client for each retry (pg.Client cannot be reused after error).
      client = createPgClient(uri, 60000);
    }
  }
  if (!connected) throw new Error('Failed to connect to Postgres after 10 attempts');

  // Bootstrap the schema_migrations tracking table before the migration runner
  // tries to query it. The runner checks this table before running each file,
  // so on a fresh database the table must exist first.
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT        NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL,
      checksum   TEXT        NOT NULL,
      CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
    )
  `);
  await runMigrations(client, MIGRATIONS_DIR);

  // Lightweight in-process Mongo satisfies runErasureReconciliation's MongoClient
  // parameter. The erasure loop never queries Mongo here because messages_log is
  // empty in the retention tests below — only the guardrail retention sweep runs.
  mongoServer = await MongoMemoryServer.create();
  mongoClient = createMongoClient(mongoServer.getUri(), { queryTimeoutMs: 30000 });
  await mongoClient.connect();
}, 120_000);

afterAll(async () => {
  await client.end();
  await container.stop();
  await mongoClient.close();
  await mongoServer.stop();
});

describe('withTransaction rollback guarantee (REQ-T-4)', () => {
  it('rolls back messages_log and sync_state when a synthetic error is thrown after upsertBatch', async () => {
    // Pre-test state: record current watermark (should be absent => epoch default).
    const defaultInitial = new Date(0);
    const preTxnWatermark = await readWatermark(client, MESSAGE_WATERMARK_KEY, { defaultInitial });

    const rows = [makeRow(), makeRow(), makeRow()];
    const batch = makeBatch(rows);

    // Run a transaction that upserts successfully, advances the watermark,
    // then throws synthetically — causing full rollback.
    const SYNTHETIC_ERROR = 'synthetic-rollback-test';
    await expect(
      withTransaction(client, async (txn) => {
        await upsertBatch(txn, batch);
        await advanceWatermark(txn, MESSAGE_WATERMARK_KEYS, new Date('2026-03-01T09:30:00.000Z'), {
          status: 'ok',
          batchSize: rows.length,
        });
        throw new Error(SYNTHETIC_ERROR);
      }),
    ).rejects.toThrow(SYNTHETIC_ERROR);

    // Assert 1: messages_log has no rows for this conversation (rollback worked).
    const msgResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM messages_log WHERE conversation_id = $1`,
      [CONV_ID],
    );
    expect(parseInt(msgResult.rows[0]!.count, 10)).toBe(0);

    // Assert 2: sync_state.messages_high_watermark is unchanged.
    const postTxnWatermark = await readWatermark(client, MESSAGE_WATERMARK_KEY, { defaultInitial });
    expect(postTxnWatermark.getTime()).toBe(preTxnWatermark.getTime());

    // Assert 3: conversations_dim has no rows for this conversation (also rolled back).
    const convResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM conversations_dim WHERE conversation_id = $1`,
      [CONV_ID],
    );
    expect(parseInt(convResult.rows[0]!.count, 10)).toBe(0);
  });

  it('commits successfully when no error is thrown', async () => {
    // Use a distinct conversation ID so this test does not conflict with the rollback test.
    const commitConvId = 'conv-txn-commit-001';
    const commitRow = makeRow({ conversation_id: commitConvId, message_id: 'msg-commit-001' });
    const commitBatch: EnrichedBatch = {
      messages: [commitRow],
      conversations: [{ ...makeConv(), conversation_id: commitConvId }],
      agents: [],
    };

    await withTransaction(client, async (txn) => {
      await upsertBatch(txn, commitBatch);
      await advanceWatermark(txn, MESSAGE_WATERMARK_KEYS, new Date('2026-03-01T08:00:00.000Z'), {
        status: 'ok',
        batchSize: 1,
      });
    });

    // The row must be committed.
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM messages_log WHERE message_id = $1 AND user_id = $2`,
      [commitRow.message_id, commitRow.user_id],
    );
    expect(parseInt(result.rows[0]!.count, 10)).toBe(1);
  });
});

// ---- Guardrail-event sync (decoupled watermark) ----

function makeGuardrail(overrides: Partial<EnrichedGuardrailEvent> = {}): EnrichedGuardrailEvent {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2, 9)}`,
    message_id: 'gr-msg-001',
    user_id: 'user-gr-001',
    conversation_id: null,
    route: 'agent',
    entity_types: ['PERSON'],
    entity_count: 1,
    source_created_at: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('guardrail-event sync — independent of the message pipeline', () => {
  it('upserts a guardrail event and refreshes conversation_id on re-sync (ON CONFLICT DO UPDATE)', async () => {
    const evt = makeGuardrail({ event_id: 'evt-doupdate-1', conversation_id: null });

    // First sync: event lands before LibreChat back-links its conversationId.
    await withTransaction(client, async (txn) => {
      await upsertGuardrailEvents(txn, [evt]);
    });

    let row = await client.query<{ conversation_id: string | null }>(
      `SELECT conversation_id FROM guardrail_events_log WHERE event_id = $1`,
      ['evt-doupdate-1'],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.conversation_id).toBeNull();

    // Second sync in the trailing safety window, after the back-link filled it in.
    await withTransaction(client, async (txn) => {
      await upsertGuardrailEvents(txn, [{ ...evt, conversation_id: 'conv-backlinked-1' }]);
    });

    row = await client.query<{ conversation_id: string | null }>(
      `SELECT conversation_id FROM guardrail_events_log WHERE event_id = $1`,
      ['evt-doupdate-1'],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.conversation_id).toBe('conv-backlinked-1');
  });

  it('advances the guardrail watermark under its own key without touching the message watermark', async () => {
    const defaultInitial = new Date(0);
    const preMessageWm = await readWatermark(client, MESSAGE_WATERMARK_KEY, { defaultInitial });
    const guardrailTs = new Date('2026-04-15T12:00:00.000Z');

    await withTransaction(client, async (txn) => {
      await upsertGuardrailEvents(txn, [makeGuardrail({ event_id: 'evt-wm-1' })]);
      await advanceWatermark(txn, GUARDRAIL_WATERMARK_KEYS, guardrailTs, { status: 'ok', batchSize: 1 });
    });

    const guardrailWm = await readWatermark(client, GUARDRAIL_WATERMARK_KEY, { defaultInitial });
    expect(guardrailWm.getTime()).toBe(guardrailTs.getTime());

    // Message watermark must be untouched by guardrail sync.
    const postMessageWm = await readWatermark(client, MESSAGE_WATERMARK_KEY, { defaultInitial });
    expect(postMessageWm.getTime()).toBe(preMessageWm.getTime());

    // The guardrail status is written under its own key, distinct from the message status.
    const status = await client.query<{ value: { status: string } }>(
      `SELECT value FROM sync_state WHERE key = $1`,
      [GUARDRAIL_STATUS_KEY],
    );
    expect(status.rows[0]!.value.status).toBe('ok');
  });
});

// ---- Guardrail retention ceiling (independent of messages) ----

const monthsAgo = (n: number): Date => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
};

async function seedGuardrailRow(
  eventId: string,
  sourceCreatedAt: Date | null,
  syncedAt: Date,
  messageId = 'gr-ret-msg',
): Promise<void> {
  await client.query(
    `INSERT INTO guardrail_events_log
       (event_id, message_id, user_id, conversation_id, route, entity_types, entity_count, source_created_at, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
    [eventId, messageId, 'user-ret-1', null, 'agent', JSON.stringify(['PERSON']), 1, sourceCreatedAt, syncedAt],
  );
}

describe('guardrail retention ceiling (independent of messages)', () => {
  it('ages out old guardrail events on their own timestamp, keeps recent ones', async () => {
    await client.query(`TRUNCATE messages_log, conversations_dim, guardrail_events_log`);

    const now = new Date();
    // Retention = 1 month; a row is deletable when its age exceeds 1 month.
    await seedGuardrailRow('evt-old', monthsAgo(3), now);
    await seedGuardrailRow('evt-recent', monthsAgo(0), now);
    // Orphan: a message_id that never matched a real message — the whole point.
    await seedGuardrailRow('evt-orphan-old', monthsAgo(6), now, 'placeholder-never-a-real-message');
    // NULL source_created_at falls back to synced_at (old) → deletable.
    await seedGuardrailRow('evt-null-old', null, monthsAgo(3));
    // NULL source_created_at, recent synced_at → kept.
    await seedGuardrailRow('evt-null-recent', null, now);

    const result = await runErasureReconciliation(client, mongoClient, 1, silentLogger);

    const remaining = await client.query<{ event_id: string }>(
      `SELECT event_id FROM guardrail_events_log ORDER BY event_id`,
    );
    expect(remaining.rows.map((r) => r.event_id)).toEqual(['evt-null-recent', 'evt-recent']);
    expect(result.retentionDeletions).toBe(3);
  });

  it('is a no-op when no guardrail events exceed the retention ceiling', async () => {
    await client.query(`TRUNCATE messages_log, conversations_dim, guardrail_events_log`);
    await seedGuardrailRow('evt-fresh-1', monthsAgo(0), new Date());
    await seedGuardrailRow('evt-fresh-2', monthsAgo(1), new Date());

    const result = await runErasureReconciliation(client, mongoClient, 24, silentLogger);

    const count = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM guardrail_events_log`);
    expect(parseInt(count.rows[0]!.count, 10)).toBe(2);
    expect(result.retentionDeletions).toBe(0);
  });
});
