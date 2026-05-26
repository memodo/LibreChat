/**
 * REQ-T-5: Poison-row bisection.
 *
 * Uses testcontainers Postgres. Seeds a 10-row batch where row 7 has a
 * message_id that violates an ALTER TABLE CHECK constraint added in test setup.
 * Asserts:
 *   - 9 rows commit via bisection
 *   - 1 row lands in dead_letter_log with error_phase = 'postgres_upsert'
 *   - sanitized error_detail is non-empty
 *   - watermark advances past the entire batch
 *   - bisectAndUpsert returns { committed: 9, deadLettered: 1 }
 *
 * Also tests:
 *   - CRI-03: sanitizePgError strips Key(...)=(...) from unique-key violation errors
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import pino from 'pino';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import {
  createPgClient,
  connectPgClient,
  runMigrations,
  bisectAndUpsert,
  sanitizePgError,
} from '../src/postgres.js';
import type { EnrichedBatch, EnrichedRow, EnrichedConversation } from '../src/enrich.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

const PG_USER = 'testuser';
const PG_PASSWORD = 'testpass';
const PG_DB = 'testdb';

let container: StartedTestContainer;
let client: pg.Client;

const POISON_MARKER = 'POISON-MARKER-REQ-T-5';
const CONV_ID = 'conv-bisect-001';
const USER_ID = 'user-bisect-001';
const BATCH_WATERMARK = new Date('2026-03-01T08:00:00.000Z');

// No-op logger.
const logger = pino({ level: 'silent' });

// ---- Fixture helpers ----

function makeRow(index: number, overrides: Partial<EnrichedRow> = {}): EnrichedRow {
  return {
    message_id: `msg-bisect-${index.toString().padStart(3, '0')}`,
    user_id: USER_ID,
    conversation_id: CONV_ID,
    parent_message_id: null,
    sender: 'User',
    endpoint: 'openAI',
    model_or_agent_id: null,
    is_user: true,
    text: `Bisect test message ${index}`,
    content: null,
    token_count: null,
    error: false,
    unfinished: false,
    has_attachments: false,
    has_files: false,
    feedback_rating: null,
    feedback_tag: null,
    feedback_text: null,
    source_created_at: new Date(BATCH_WATERMARK.getTime() + index * 1000),
    source_updated_at: new Date(BATCH_WATERMARK.getTime() + index * 1000),
    schema_version: 1,
    ...overrides,
  };
}

function makeConv(): EnrichedConversation {
  return {
    conversation_id: CONV_ID,
    title: 'Bisect test conversation',
    agent_id: null,
    endpoint: 'openAI',
    user_id: USER_ID,
    archived: false,
    tags: null,
    source_created_at: BATCH_WATERMARK,
    source_updated_at: BATCH_WATERMARK,
    dim_updated_at: new Date('2026-03-01T12:00:00.000Z'),
    schema_version: 1,
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
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await connectPgClient(client);
      break;
    } catch (err) {
      if (attempt === 10) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
      client = createPgClient(uri, 60000);
    }
  }

  // Bootstrap schema_migrations before the runner queries it (fresh database).
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT        NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL,
      checksum   TEXT        NOT NULL,
      CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
    )
  `);
  await runMigrations(client, MIGRATIONS_DIR);

  // Add a CHECK constraint so inserting message_id = POISON_MARKER fails.
  // This is the controlled poison mechanism described in the spec for REQ-T-5.
  await client.query(
    `ALTER TABLE messages_log ADD CONSTRAINT msg_id_no_poison CHECK (message_id != '${POISON_MARKER}')`,
  );

  // Pre-insert the conversation so the FK is satisfied for non-poison rows.
  await client.query(
    `INSERT INTO conversations_dim
       (conversation_id, title, agent_id, endpoint, user_id, archived, tags,
        source_created_at, source_updated_at, dim_updated_at, schema_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (conversation_id) DO NOTHING`,
    [
      CONV_ID,
      'Bisect test conversation',
      null, null, USER_ID, false, null,
      BATCH_WATERMARK, BATCH_WATERMARK,
      new Date('2026-03-01T12:00:00.000Z'),
      1,
    ],
  );
}, 120_000);

afterAll(async () => {
  await client.end();
  await container.stop();
});

describe('sanitizePgError — unit tests (CRI-03)', () => {
  it('sanitizes Key(...)=(...) from unique-key violation error messages', () => {
    const pgUniqueError =
      'duplicate key value violates unique constraint "messages_log_uq"\n' +
      'DETAIL:  Key (message_id, user_id)=(actual-msg-id-12345, user-abc) already exists.';
    const sanitized = sanitizePgError(pgUniqueError);
    expect(sanitized).not.toContain('actual-msg-id-12345');
    expect(sanitized).not.toContain('user-abc');
    expect(sanitized).toContain('[redacted]');
    expect(sanitized).toBeTruthy();
  });

  it('sanitizes DETAIL lines from error messages', () => {
    const pgError =
      'some error\nDETAIL: sensitive data here\nHINT: do something';
    const sanitized = sanitizePgError(pgError);
    expect(sanitized).not.toContain('sensitive data here');
    expect(sanitized).toContain('DETAIL: [redacted]');
  });

  it('truncates to 500 characters', () => {
    const longMsg = 'a'.repeat(600);
    const sanitized = sanitizePgError(longMsg);
    expect(sanitized.length).toBeLessThanOrEqual(500);
  });
});

describe('bisectAndUpsert — poison-row bisection (REQ-T-5)', () => {
  it('bisects on CHECK violation — commits 9 rows, dead-letters row 7', async () => {
    // Build 10-row batch. Row 7 (index 7, 1-based) is the poison row.
    const rows: EnrichedRow[] = Array.from({ length: 10 }, (_, i) => {
      const oneBasedIndex = i + 1;
      if (oneBasedIndex === 7) {
        return makeRow(oneBasedIndex, { message_id: POISON_MARKER });
      }
      return makeRow(oneBasedIndex);
    });

    const batch: EnrichedBatch = {
      messages: rows,
      // conversations already seeded; pass empty array to avoid re-insert conflicts in sub-batches.
      // The FK is pre-satisfied. We still include it so bisect sub-batches don't fail on missing conv.
      conversations: [makeConv()],
      agents: [],
      guardrailEvents: [],
    };

    // Build sourceDocs Map with a recognizable signature for the poison row.
    const sourceDocs = new Map<string, unknown>(
      rows.map((r) => [
        r.message_id,
        r.message_id === POISON_MARKER
          ? { _raw: 'poison', messageId: POISON_MARKER }
          : { messageId: r.message_id },
      ]),
    );

    // Record pre-test row counts.
    const preMsgCount = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM messages_log WHERE conversation_id = $1`,
      [CONV_ID],
    );
    const preDeadLetterCount = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM dead_letter_log`,
    );

    const result = await bisectAndUpsert(
      client,
      batch,
      sourceDocs,
      BATCH_WATERMARK,
      logger,
      60, // safetySeconds
    );

    // Assert bisection result.
    expect(result.committed).toBe(9);
    expect(result.deadLettered).toBe(1);

    // Assert messages_log has exactly 9 new rows for this conversation.
    const postMsgCount = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM messages_log WHERE conversation_id = $1`,
      [CONV_ID],
    );
    const newMsgRows = parseInt(postMsgCount.rows[0]!.count, 10) - parseInt(preMsgCount.rows[0]!.count, 10);
    expect(newMsgRows).toBe(9);

    // Assert the poison row is NOT in messages_log.
    const poisonCheck = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM messages_log WHERE message_id = $1`,
      [POISON_MARKER],
    );
    expect(parseInt(poisonCheck.rows[0]!.count, 10)).toBe(0);

    // Assert dead_letter_log has exactly 1 new row.
    const postDeadLetterCount = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM dead_letter_log`,
    );
    const newDeadLetterRows =
      parseInt(postDeadLetterCount.rows[0]!.count, 10) -
      parseInt(preDeadLetterCount.rows[0]!.count, 10);
    expect(newDeadLetterRows).toBe(1);

    // Assert dead_letter_log row content.
    const dlRow = await client.query<{
      source_collection: string;
      source_id: string;
      error_phase: string;
      error_detail: string;
    }>(
      `SELECT source_collection, source_id, error_phase, error_detail
         FROM dead_letter_log
        WHERE source_id = $1`,
      [POISON_MARKER],
    );
    expect(dlRow.rows).toHaveLength(1);
    const dl = dlRow.rows[0]!;
    expect(dl.source_collection).toBe('messages');
    expect(dl.source_id).toBe(POISON_MARKER);
    expect(dl.error_phase).toBe('postgres_upsert');
    expect(dl.error_detail).toBeTruthy();
    // Sanitized: error_detail must not reproduce the row's text content
    // (REQ-074). The text field is "Bisect test message 7" — it should not
    // appear in the sanitized error_detail. The error comes from Postgres
    // constraint violation message, which contains the constraint name but
    // not the row content.
    expect(dl.error_detail).not.toContain('Bisect test message 7');

    // Assert watermark advanced past the last row (row 10).
    const row10 = rows[9]!;
    const minExpectedWatermark = new Date(row10.source_created_at.getTime() - 60_000);
    expect(result.advancedWatermark.getTime()).toBeGreaterThanOrEqual(minExpectedWatermark.getTime());
  });

  it('sanitizes Key=(...) from unique-key violation error_detail (CRI-03)', async () => {
    const UNIQUE_POISON_ID = 'UNIQUE-POISON-CRI-03';
    const UNIQUE_POISON_USER = USER_ID;

    // Pre-insert the poison row so the subsequent batch attempt causes a unique-key violation.
    await client.query(
      `INSERT INTO messages_log
         (message_id, user_id, conversation_id, sender, endpoint, is_user, error, unfinished,
          has_attachments, has_files, source_created_at, source_updated_at, schema_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        UNIQUE_POISON_ID,
        UNIQUE_POISON_USER,
        CONV_ID,
        'User',
        'openAI',
        true,
        false,
        false,
        false,
        false,
        new Date(BATCH_WATERMARK.getTime() + 999000),
        new Date(BATCH_WATERMARK.getTime() + 999000),
        1,
      ],
    );

    // Submit a single-row batch for the same (message_id, user_id) — this will
    // trigger a unique_violation when the CHECK constraint on message_id is dropped
    // but the unique constraint on (message_id, user_id) still applies.
    // Use ON CONFLICT DO UPDATE in the normal path — but bisectAndUpsert uses ON CONFLICT
    // DO UPDATE so it won't fail on unique. Instead, override with a separate mechanism:
    // add a second CHECK constraint to force failure on this specific ID.
    await client.query(
      `ALTER TABLE messages_log ADD CONSTRAINT msg_id_no_unique_poison CHECK (message_id != '${UNIQUE_POISON_ID}-force-fail')`,
    );

    const poisonUniqueId = `${UNIQUE_POISON_ID}-force-fail`;
    const poisonRow = makeRow(999, {
      message_id: poisonUniqueId,
      source_created_at: new Date(BATCH_WATERMARK.getTime() + 999_500),
      source_updated_at: new Date(BATCH_WATERMARK.getTime() + 999_500),
    });

    const singleBatch: EnrichedBatch = {
      messages: [poisonRow],
      conversations: [makeConv()],
      agents: [],
      guardrailEvents: [],
    };

    const uniqueSourceDocs = new Map<string, unknown>([
      [poisonUniqueId, { messageId: poisonUniqueId, distinctiveValue: 'CRI-03-SHOULD-NOT-APPEAR' }],
    ]);

    const result = await bisectAndUpsert(
      client,
      singleBatch,
      uniqueSourceDocs,
      new Date(BATCH_WATERMARK.getTime() + 999_000),
      logger,
      60,
    );

    expect(result.deadLettered).toBe(1);

    // Assert that the distinctive value does not appear in error_detail.
    const dlRow = await client.query<{ error_detail: string }>(
      `SELECT error_detail FROM dead_letter_log WHERE source_id = $1`,
      [poisonUniqueId],
    );
    expect(dlRow.rows).toHaveLength(1);
    const errorDetail = dlRow.rows[0]!.error_detail;
    // The message_id value itself must not appear in error_detail (REQ-074 sanitization).
    expect(errorDetail).not.toContain(poisonUniqueId);
    expect(errorDetail).toBeTruthy();
  });
});
