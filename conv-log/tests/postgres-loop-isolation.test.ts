/**
 * CRI-01: Cross-loop transaction isolation regression test.
 *
 * Verifies that the ingestion client and the reconciliation client use
 * separate Postgres connections and that their transactions are isolated.
 *
 * Specifically:
 *   1. Opens a transaction on the ingestion client (BEGIN, inserts a row).
 *   2. Concurrently issues an INSERT on the reconciliation client.
 *   3. Rolls back the ingestion transaction.
 *   4. Asserts the reconciliation client's INSERT is NOT rolled back —
 *      proving they are on separate connections with isolated transaction scopes.
 *
 * This test would FAIL if both clients shared a single connection, because
 * the ROLLBACK on the ingestion client would also roll back the reconciliation
 * client's work (single connection, single transaction state).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { createPgClient, connectPgClient, runMigrations } from '../src/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

const PG_USER = 'isouser';
const PG_PASSWORD = 'isopass';
const PG_DB = 'isodb';

let container: StartedTestContainer;
let ingestionClient: pg.Client;
let reconciliationClient: pg.Client;

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

  ingestionClient = createPgClient(uri, 60000);
  reconciliationClient = createPgClient(uri, 60000);

  // Connect both clients — retry for Postgres readiness.
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await connectPgClient(ingestionClient);
      break;
    } catch (err) {
      if (attempt === 10) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
      ingestionClient = createPgClient(uri, 60000);
    }
  }
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await connectPgClient(reconciliationClient);
      break;
    } catch (err) {
      if (attempt === 10) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
      reconciliationClient = createPgClient(uri, 60000);
    }
  }

  // Run migrations on ingestion client (sequential startup, as per production).
  await runMigrations(ingestionClient, MIGRATIONS_DIR);

  // Seed a minimal conversation so FK constraints are satisfied.
  await ingestionClient.query(
    `INSERT INTO conversations_dim
       (conversation_id, title, agent_id, endpoint, user_id, archived, tags,
        source_created_at, source_updated_at, dim_updated_at, schema_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (conversation_id) DO NOTHING`,
    [
      'conv-iso-001', 'Isolation test', null, 'openAI', 'user-iso-001',
      false, null,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-01T00:00:00Z'),
      1,
    ],
  );
}, 120_000);

afterAll(async () => {
  await ingestionClient.end();
  await reconciliationClient.end();
  await container.stop();
});

describe('pg client isolation — ingestion and reconciliation clients are independent (CRI-01)', () => {
  it('a ROLLBACK on the ingestion client does NOT roll back work committed on the reconciliation client', async () => {
    const INGESTION_MSG_ID = 'msg-ingestion-iso-001';
    const RECONCILE_MSG_ID = 'msg-reconcile-iso-001';

    // Step 1: open a transaction on the ingestion client and insert a row (do NOT commit yet).
    await ingestionClient.query('BEGIN');
    await ingestionClient.query(
      `INSERT INTO messages_log
         (message_id, user_id, conversation_id, sender, endpoint, is_user, error, unfinished,
          has_attachments, has_files, source_created_at, source_updated_at, schema_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        INGESTION_MSG_ID, 'user-iso-001', 'conv-iso-001', 'User', 'openAI',
        true, false, false, false, false,
        new Date('2026-01-01T01:00:00Z'),
        new Date('2026-01-01T01:00:00Z'),
        1,
      ],
    );

    // Step 2: on the reconciliation client, commit its own independent row.
    // This must succeed and be durable even while the ingestion transaction is open.
    await reconciliationClient.query('BEGIN');
    await reconciliationClient.query(
      `INSERT INTO messages_log
         (message_id, user_id, conversation_id, sender, endpoint, is_user, error, unfinished,
          has_attachments, has_files, source_created_at, source_updated_at, schema_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        RECONCILE_MSG_ID, 'user-iso-001', 'conv-iso-001', 'User', 'openAI',
        true, false, false, false, false,
        new Date('2026-01-01T02:00:00Z'),
        new Date('2026-01-01T02:00:00Z'),
        1,
      ],
    );
    await reconciliationClient.query('COMMIT');

    // Step 3: roll back the ingestion transaction.
    await ingestionClient.query('ROLLBACK');

    // Step 4: assert the ingestion row was rolled back.
    const ingestionCheck = await ingestionClient.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM messages_log WHERE message_id = $1`,
      [INGESTION_MSG_ID],
    );
    expect(parseInt(ingestionCheck.rows[0]!.count, 10)).toBe(0);

    // Step 5: assert the reconciliation row survived the ingestion rollback.
    // If the clients shared a connection, this would also be 0 (rolled back).
    const reconcileCheck = await reconciliationClient.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM messages_log WHERE message_id = $1`,
      [RECONCILE_MSG_ID],
    );
    expect(parseInt(reconcileCheck.rows[0]!.count, 10)).toBe(1);
  });

  it('a transaction on ingestion client is not visible to reconciliation client until committed', async () => {
    const ISOLATED_MSG_ID = 'msg-isolation-visibility-001';

    // Open a transaction on ingestion client, insert a row, do NOT commit.
    await ingestionClient.query('BEGIN');
    await ingestionClient.query(
      `INSERT INTO messages_log
         (message_id, user_id, conversation_id, sender, endpoint, is_user, error, unfinished,
          has_attachments, has_files, source_created_at, source_updated_at, schema_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        ISOLATED_MSG_ID, 'user-iso-001', 'conv-iso-001', 'User', 'openAI',
        true, false, false, false, false,
        new Date('2026-01-01T03:00:00Z'),
        new Date('2026-01-01T03:00:00Z'),
        1,
      ],
    );

    // Reconciliation client should NOT see the uncommitted row.
    const beforeCommit = await reconciliationClient.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM messages_log WHERE message_id = $1`,
      [ISOLATED_MSG_ID],
    );
    expect(parseInt(beforeCommit.rows[0]!.count, 10)).toBe(0);

    // Commit the ingestion transaction.
    await ingestionClient.query('COMMIT');

    // Now the reconciliation client sees the row.
    const afterCommit = await reconciliationClient.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM messages_log WHERE message_id = $1`,
      [ISOLATED_MSG_ID],
    );
    expect(parseInt(afterCommit.rows[0]!.count, 10)).toBe(1);
  });
});
