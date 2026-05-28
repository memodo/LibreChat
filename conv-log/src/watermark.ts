import type pg from 'pg';
import type { Txn } from './postgres.js';

export type WatermarkValue = { ts: Date };

/** Read the persisted watermark. Falls back to opts.defaultInitial when absent. */
export async function readWatermark(
  client: pg.Client,
  opts: { defaultInitial: Date },
): Promise<Date> {
  const result = await client.query<{ value: { ts: string } }>(
    `SELECT value FROM sync_state WHERE key = 'messages_high_watermark'`,
  );
  const row = result.rows[0];
  if (row === undefined) return opts.defaultInitial;
  return new Date(row.value.ts);
}

/**
 * Persist the watermark and last-sync status atomically.
 * Must be called inside an open transaction (Txn) — the type enforces this.
 * The caller is responsible for computing the safety-margin offset before passing newValue.
 */
export async function advanceWatermark(
  txn: Txn,
  newValue: Date,
  status: { status: 'ok' | 'error' | 'dead_letter'; batchSize: number; error?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const watermarkJson = JSON.stringify({ ts: newValue.toISOString() });
  const statusJson = JSON.stringify({ ts: now, ...status });

  await txn.client.query(
    `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('messages_high_watermark', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [watermarkJson],
  );

  await txn.client.query(
    `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('last_sync_status', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [statusJson],
  );
}
