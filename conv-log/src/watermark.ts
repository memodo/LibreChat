import type pg from 'pg';
import type { Txn } from './postgres.js';

export type WatermarkValue = { ts: Date };

// ---- sync_state keys (single source of truth) ----
// The message and guardrail pipelines each advance an independent high-watermark
// so that guardrail-event sync is not gated on the message batch (see field-mapping.md).
export const MESSAGE_WATERMARK_KEY = 'messages_high_watermark';
export const MESSAGE_STATUS_KEY = 'last_sync_status';
export const GUARDRAIL_WATERMARK_KEY = 'guardrail_high_watermark';
export const GUARDRAIL_STATUS_KEY = 'guardrail_last_sync_status';

/** Read a persisted watermark by key. Falls back to opts.defaultInitial when absent. */
export async function readWatermark(
  client: pg.Client,
  key: string,
  opts: { defaultInitial: Date },
): Promise<Date> {
  const result = await client.query<{ value: { ts: string } }>(
    `SELECT value FROM sync_state WHERE key = $1`,
    [key],
  );
  const row = result.rows[0];
  if (row === undefined) return opts.defaultInitial;
  return new Date(row.value.ts);
}

/**
 * Persist a watermark and its last-sync status atomically under the given keys.
 * Must be called inside an open transaction (Txn) — the type enforces this.
 * The caller is responsible for computing the safety-margin offset before passing newValue.
 */
export async function advanceWatermark(
  txn: Txn,
  keys: { watermarkKey: string; statusKey: string },
  newValue: Date,
  status: { status: 'ok' | 'error' | 'dead_letter'; batchSize: number; error?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const watermarkJson = JSON.stringify({ ts: newValue.toISOString() });
  const statusJson = JSON.stringify({ ts: now, ...status });

  await txn.client.query(
    `INSERT INTO sync_state (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [keys.watermarkKey, watermarkJson],
  );

  await txn.client.query(
    `INSERT INTO sync_state (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [keys.statusKey, statusJson],
  );
}
