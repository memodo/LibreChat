/**
 * CRI-02: Fresh-database migration regression test.
 *
 * Spins up an empty testcontainers Postgres — no manual schema_migrations
 * bootstrap in beforeAll. Asserts that runMigrations completes successfully
 * and that both 001_init and 002_dead_letter_unique are recorded.
 *
 * This test guards against the first-run crash where runMigrations queried
 * schema_migrations before 001_init.sql created the table.
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

const PG_USER = 'freshuser';
const PG_PASSWORD = 'freshpass';
const PG_DB = 'freshdb';

let container: StartedTestContainer;
let client: pg.Client;

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

  // Retry connecting — forListeningPorts fires when TCP is open but Postgres
  // may not yet be accepting queries.
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

  // NOTE: intentionally NO manual schema_migrations bootstrap here.
  // This is the regression test for CRI-02 — runMigrations must handle a fresh DB.
}, 120_000);

afterAll(async () => {
  await client.end();
  await container.stop();
});

describe('runMigrations on a fresh database (CRI-02)', () => {
  it('completes without error on a completely empty Postgres — no pre-existing schema_migrations table', async () => {
    // This must not throw even though schema_migrations does not exist yet.
    await expect(runMigrations(client, MIGRATIONS_DIR)).resolves.toBeUndefined();
  });

  it('records 001_init migration in schema_migrations', async () => {
    const result = await client.query<{ version: string }>(
      `SELECT version FROM schema_migrations WHERE version = $1`,
      ['001_init'],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.version).toBe('001_init');
  });

  it('records 002_dead_letter_unique migration in schema_migrations', async () => {
    const result = await client.query<{ version: string }>(
      `SELECT version FROM schema_migrations WHERE version = $1`,
      ['002_dead_letter_unique'],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.version).toBe('002_dead_letter_unique');
  });

  it('is idempotent — running runMigrations a second time does not throw or duplicate rows', async () => {
    await expect(runMigrations(client, MIGRATIONS_DIR)).resolves.toBeUndefined();

    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM schema_migrations`,
    );
    // Exactly as many rows as there are migration files — no duplicates.
    const count = parseInt(result.rows[0]!.count, 10);
    expect(count).toBeGreaterThanOrEqual(2);

    // Count migration files to verify exact match.
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3}_.+\.sql$/.test(f));
    expect(count).toBe(files.length);
  });
});
