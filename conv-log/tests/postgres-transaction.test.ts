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
import {
  createPgClient,
  connectPgClient,
  runMigrations,
  withTransaction,
  upsertBatch,
} from '../src/postgres.js';
import { readWatermark, advanceWatermark } from '../src/watermark.js';
import type { EnrichedBatch, EnrichedRow, EnrichedConversation } from '../src/enrich.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

const PG_USER = 'testuser';
const PG_PASSWORD = 'testpass';
const PG_DB = 'testdb';

let container: StartedTestContainer;
let client: pg.Client;

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
    guardrailEvents: [],
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
}, 120_000);

afterAll(async () => {
  await client.end();
  await container.stop();
});

describe('withTransaction rollback guarantee (REQ-T-4)', () => {
  it('rolls back messages_log and sync_state when a synthetic error is thrown after upsertBatch', async () => {
    // Pre-test state: record current watermark (should be absent => epoch default).
    const defaultInitial = new Date(0);
    const preTxnWatermark = await readWatermark(client, { defaultInitial });

    const rows = [makeRow(), makeRow(), makeRow()];
    const batch = makeBatch(rows);

    // Run a transaction that upserts successfully, advances the watermark,
    // then throws synthetically — causing full rollback.
    const SYNTHETIC_ERROR = 'synthetic-rollback-test';
    await expect(
      withTransaction(client, async (txn) => {
        await upsertBatch(txn, batch);
        await advanceWatermark(txn, new Date('2026-03-01T09:30:00.000Z'), {
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
    const postTxnWatermark = await readWatermark(client, { defaultInitial });
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
      guardrailEvents: [],
    };

    await withTransaction(client, async (txn) => {
      await upsertBatch(txn, commitBatch);
      await advanceWatermark(txn, new Date('2026-03-01T08:00:00.000Z'), {
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
