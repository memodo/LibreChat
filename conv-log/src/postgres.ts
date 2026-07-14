import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { advanceWatermark, MESSAGE_WATERMARK_KEY, MESSAGE_STATUS_KEY } from './watermark.js';
import type { MongoClient } from 'mongodb';
import type { Logger as PinoLogger } from 'pino';
import type { EnrichedBatch, EnrichedGuardrailEvent } from './enrich.js';

const MESSAGE_WATERMARK_KEYS = { watermarkKey: MESSAGE_WATERMARK_KEY, statusKey: MESSAGE_STATUS_KEY };

// ---- Transaction handle ----
// The __brand field makes Txn structurally distinct from a bare pg.Client.
// TypeScript enforces "must be inside a transaction" wherever Txn is required.

export type Txn = { client: pg.Client; readonly __brand: 'in-transaction' };

// ---- Client factory ----

export function createPgClient(uri: string, statementTimeoutMs: number): pg.Client {
  const client = new pg.Client({ connectionString: uri });
  // statement_timeout is set per-session after connect (see connectWithTimeout below)
  // Store it so callers can apply it after connecting.
  (client as pg.Client & { _statementTimeoutMs: number })._statementTimeoutMs = statementTimeoutMs;
  return client;
}

/** Connect a pg.Client and set the per-session statement_timeout. */
export async function connectPgClient(client: pg.Client): Promise<void> {
  await client.connect();
  const timeoutMs = (client as pg.Client & { _statementTimeoutMs?: number })._statementTimeoutMs ?? 60000;
  // CRI-13: use set_config() with parameter binding instead of string interpolation.
  await client.query('SELECT set_config($1, $2, false)', ['statement_timeout', String(timeoutMs)]);
}

// ---- Transaction helper ----

export async function withTransaction<T>(
  client: pg.Client,
  fn: (txn: Txn) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  const txn: Txn = { client, __brand: 'in-transaction' };
  try {
    const result = await fn(txn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// ---- Migrations ----

const MIGRATION_FILE_PATTERN = /^\d{3}_.+\.sql$/;

export async function runMigrations(client: pg.Client, migrationsDir: string): Promise<void> {
  // CRI-02: Pre-create schema_migrations before the file loop so fresh-DB
  // deployments don't crash when the SELECT below runs before the table exists.
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT        NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL,
      checksum   TEXT        NOT NULL,
      CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((f) => MIGRATION_FILE_PATTERN.test(f))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const filePath = path.join(migrationsDir, file);
    const sql = await fs.readFile(filePath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    const existing = await client.query<{ checksum: string }>(
      `SELECT checksum FROM schema_migrations WHERE version = $1`,
      [version],
    );

    if (existing.rows.length > 0) {
      const existingRow = existing.rows[0];
      if (existingRow === undefined || existingRow.checksum !== checksum) {
        const recorded = existingRow?.checksum ?? '(missing)';
        throw new Error(
          `Migration checksum mismatch for ${version}: recorded ${recorded}, on-disk ${checksum}. Do not mutate applied migrations.`,
        );
      }
      continue;
    }

    await withTransaction(client, async (txn) => {
      await txn.client.query(sql);
      await txn.client.query(
        `INSERT INTO schema_migrations (version, applied_at, checksum) VALUES ($1, NOW(), $2)`,
        [version, checksum],
      );
    });
  }
}

// ---- Batch upsert ----

export async function upsertBatch(txn: Txn, batch: EnrichedBatch, statementTimeoutMs = 60000): Promise<void> {
  await txn.client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);

  for (const conv of batch.conversations) {
    await txn.client.query(
      `INSERT INTO conversations_dim
         (conversation_id, title, agent_id, endpoint, user_id, archived, tags,
          source_created_at, source_updated_at, dim_updated_at, schema_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
       ON CONFLICT (conversation_id) DO UPDATE SET
         title             = EXCLUDED.title,
         agent_id          = EXCLUDED.agent_id,
         endpoint          = EXCLUDED.endpoint,
         user_id           = EXCLUDED.user_id,
         archived          = EXCLUDED.archived,
         tags              = EXCLUDED.tags,
         source_created_at = EXCLUDED.source_created_at,
         source_updated_at = EXCLUDED.source_updated_at,
         dim_updated_at    = EXCLUDED.dim_updated_at,
         schema_version    = EXCLUDED.schema_version`,
      [
        conv.conversation_id,
        conv.title,
        conv.agent_id,
        conv.endpoint,
        conv.user_id,
        conv.archived,
        conv.tags != null ? JSON.stringify(conv.tags) : null,
        conv.source_created_at,
        conv.source_updated_at,
        conv.dim_updated_at,
        conv.schema_version,
      ],
    );
  }

  for (const agent of batch.agents) {
    await txn.client.query(
      `INSERT INTO agents_dim
         (agent_id, name, model_underlying, description, last_seen_at, dim_updated_at, schema_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (agent_id) DO UPDATE SET
         name             = EXCLUDED.name,
         model_underlying = EXCLUDED.model_underlying,
         description      = EXCLUDED.description,
         last_seen_at     = EXCLUDED.last_seen_at,
         dim_updated_at   = EXCLUDED.dim_updated_at,
         schema_version   = EXCLUDED.schema_version`,
      [
        agent.agent_id,
        agent.name,
        agent.model_underlying,
        agent.description,
        agent.last_seen_at,
        agent.dim_updated_at,
        agent.schema_version,
      ],
    );
  }

  for (const msg of batch.messages) {
    await txn.client.query(
      `INSERT INTO messages_log
         (message_id, user_id, conversation_id, parent_message_id, sender, endpoint,
          model_or_agent_id, is_user, text, content, token_count, error, unfinished,
          has_attachments, has_files, feedback_rating, feedback_tag, feedback_text,
          source_created_at, source_updated_at, schema_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21)
       ON CONFLICT (message_id, user_id) DO UPDATE SET
         conversation_id   = EXCLUDED.conversation_id,
         parent_message_id = EXCLUDED.parent_message_id,
         sender            = EXCLUDED.sender,
         endpoint          = EXCLUDED.endpoint,
         model_or_agent_id = EXCLUDED.model_or_agent_id,
         is_user           = EXCLUDED.is_user,
         text              = EXCLUDED.text,
         content           = EXCLUDED.content,
         token_count       = EXCLUDED.token_count,
         error             = EXCLUDED.error,
         unfinished        = EXCLUDED.unfinished,
         has_attachments   = EXCLUDED.has_attachments,
         has_files         = EXCLUDED.has_files,
         feedback_rating   = EXCLUDED.feedback_rating,
         feedback_tag      = EXCLUDED.feedback_tag,
         feedback_text     = EXCLUDED.feedback_text,
         source_created_at = EXCLUDED.source_created_at,
         source_updated_at = EXCLUDED.source_updated_at,
         schema_version    = EXCLUDED.schema_version,
         synced_at         = NOW()`,
      [
        msg.message_id,
        msg.user_id,
        msg.conversation_id,
        msg.parent_message_id,
        msg.sender,
        msg.endpoint,
        msg.model_or_agent_id,
        msg.is_user,
        msg.text,
        msg.content != null ? JSON.stringify(msg.content) : null,
        msg.token_count,
        msg.error,
        msg.unfinished,
        msg.has_attachments,
        msg.has_files,
        msg.feedback_rating,
        msg.feedback_tag != null ? JSON.stringify(msg.feedback_tag) : null,
        msg.feedback_text,
        msg.source_created_at,
        msg.source_updated_at,
        msg.schema_version,
      ],
    );
  }

}

// ---- Guardrail-event upsert ----
//
// Guardrail events are synced on their own watermark (decoupled from the message
// batch), so this is a standalone upsert rather than part of upsertBatch.
// ON CONFLICT DO UPDATE (not DO NOTHING): the safety-margin trailing window means
// an event can be re-read on a later tick after LibreChat back-links its real
// message_id / conversation_id — the re-read must refresh those columns.
export async function upsertGuardrailEvents(txn: Txn, events: EnrichedGuardrailEvent[]): Promise<void> {
  for (const evt of events) {
    await txn.client.query(
      `INSERT INTO guardrail_events_log
         (event_id, message_id, user_id, conversation_id, route, entity_types, entity_count, source_created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       ON CONFLICT (event_id) DO UPDATE SET
         message_id      = EXCLUDED.message_id,
         user_id         = EXCLUDED.user_id,
         conversation_id = EXCLUDED.conversation_id,
         route           = EXCLUDED.route,
         entity_types    = EXCLUDED.entity_types,
         entity_count    = EXCLUDED.entity_count,
         source_created_at = EXCLUDED.source_created_at`,
      [
        evt.event_id,
        evt.message_id,
        evt.user_id,
        evt.conversation_id,
        evt.route,
        evt.entity_types != null ? JSON.stringify(evt.entity_types) : null,
        evt.entity_count,
        evt.source_created_at,
      ],
    );
  }
}

// ---- Dead-letter ----

export async function runDeadLetter(
  txn: Txn,
  sourceCollection: string,
  sourceId: string,
  rawDoc: unknown,
  errorPhase: string,
  errorDetail: string,
): Promise<void> {
  await txn.client.query(
    `INSERT INTO dead_letter_log
       (source_collection, source_id, raw, error_phase, error_detail, first_failed_at, last_failed_at, retry_count)
     VALUES ($1, $2, $3::jsonb, $4, $5, NOW(), NOW(), 1)
     ON CONFLICT (source_collection, source_id) DO UPDATE SET
       retry_count  = dead_letter_log.retry_count + 1,
       last_failed_at = NOW(),
       error_detail = EXCLUDED.error_detail`,
    [sourceCollection, sourceId, JSON.stringify(rawDoc), errorPhase, errorDetail],
  );
}

// ---- PG error sanitizer (CRI-03) ----
//
// Strips DETAIL lines and Key(...)=(...) substrings from Postgres error messages
// so that row-payload values (messageId, userId, etc.) are never stored in
// dead_letter_log.error_detail (REQ-074).

export function sanitizePgError(msg: string): string {
  return msg
    .replace(/DETAIL:[\s\S]*?(?=\n[A-Z]+:|$)/g, 'DETAIL: [redacted]')
    .replace(/Key \([^)]+\)=\([^)]+\)/g, 'Key (...)=([redacted])')
    .slice(0, 500);
}

// ---- Bisect-and-upsert ----

type BisectResult = { committed: number; deadLettered: number; advancedWatermark: Date };

const safetyOffsetMs = (safetySeconds: number): number => safetySeconds * 1000;

// Returns max createdAt from a batch of messages.
const batchMaxCreatedAt = (messages: EnrichedBatch['messages']): Date | null => {
  const first = messages[0];
  if (first === undefined) return null;
  return messages.reduce<Date>(
    (max, m) => (m.source_created_at > max ? m.source_created_at : max),
    first.source_created_at,
  );
};

// CRI-09: metrics interface passed into bisectAndUpsert so the function can
// record bisection-depth overflow without importing the full index.ts registry.
export type BisectMetrics = {
  deadLetterTotal: { labels: (phase: string) => { inc: (n?: number) => void } };
  bisectionMaxDepthObserved: { set: (n: number) => void };
};

export async function bisectAndUpsert(
  client: pg.Client,
  batch: EnrichedBatch,
  sourceDocs: Map<string, unknown>,
  watermark: Date,
  logger: PinoLogger,
  safetySeconds = 60,
  statementTimeoutMs = 60000,
  bisectMetrics?: BisectMetrics,
): Promise<BisectResult> {
  // CRI-09: depth cap = ceil(log2(batch.messages.length)) + 2, minimum 4.
  const initialBatchSize = batch.messages.length;
  const depthCap = Math.max(4, Math.ceil(Math.log2(Math.max(1, initialBatchSize))) + 2);
  let maxDepthObserved = 0;

  const attempt = async (
    subBatch: EnrichedBatch,
    currentWatermark: Date,
    depth: number,
  ): Promise<BisectResult> => {
    if (depth > maxDepthObserved) maxDepthObserved = depth;

    if (subBatch.messages.length === 0) {
      return { committed: 0, deadLettered: 0, advancedWatermark: currentWatermark };
    }

    // CRI-09: recursion-depth cap — fast-fail entire sub-batch to dead_letter.
    if (depth > depthCap) {
      logger.error(
        { phase: 'bisection_overflow', depth, batchSize: subBatch.messages.length },
        'Bisection depth cap exceeded — fast-failing sub-batch to dead_letter',
      );

      let deadWatermark = currentWatermark;
      for (const msg of subBatch.messages) {
        const rawDoc = sourceDocs.get(msg.message_id) ?? { messageId: msg.message_id };
        await withTransaction(client, async (txn) => {
          await runDeadLetter(
            txn,
            'messages',
            msg.message_id,
            rawDoc,
            'bisection_overflow',
            'recursion-depth cap exceeded',
          );
          deadWatermark = new Date(msg.source_created_at.getTime() - safetyOffsetMs(safetySeconds));
          await advanceWatermark(txn, MESSAGE_WATERMARK_KEYS, deadWatermark, {
            status: 'dead_letter',
            batchSize: 1,
            error: 'bisection_overflow',
          });
        });
        bisectMetrics?.deadLetterTotal.labels('bisection_overflow').inc();
      }

      return {
        committed: 0,
        deadLettered: subBatch.messages.length,
        advancedWatermark: deadWatermark,
      };
    }

    try {
      let result: BisectResult = { committed: 0, deadLettered: 0, advancedWatermark: currentWatermark };

      await withTransaction(client, async (txn) => {
        await upsertBatch(txn, subBatch, statementTimeoutMs);
        const maxCreatedAt = batchMaxCreatedAt(subBatch.messages);
        const newWatermark = maxCreatedAt != null
          ? new Date(maxCreatedAt.getTime() - safetyOffsetMs(safetySeconds))
          : currentWatermark;
        await advanceWatermark(txn, MESSAGE_WATERMARK_KEYS, newWatermark, { status: 'ok', batchSize: subBatch.messages.length });
        result = { committed: subBatch.messages.length, deadLettered: 0, advancedWatermark: newWatermark };
      });

      return result;
    } catch (err) {
      if (subBatch.messages.length === 1) {
        // Single-row failure — dead-letter it.
        const msg = subBatch.messages[0];
        if (msg === undefined) return { committed: 0, deadLettered: 0, advancedWatermark: currentWatermark };

        const rawDoc = sourceDocs.get(msg.message_id) ?? { messageId: msg.message_id };
        // CRI-03: sanitize error detail so row payload (messageId, userId) is not stored.
        const rawMsg = err instanceof Error ? err.message : String(err);
        const errorDetail = sanitizePgError(rawMsg);

        logger.warn({ phase: 'dead_letter', messageId: msg.message_id }, 'Dead-lettering single row');

        let deadWatermark = currentWatermark;
        await withTransaction(client, async (txn) => {
          await runDeadLetter(txn, 'messages', msg.message_id, rawDoc, 'postgres_upsert', errorDetail);
          deadWatermark = new Date(msg.source_created_at.getTime() - safetyOffsetMs(safetySeconds));
          await advanceWatermark(txn, MESSAGE_WATERMARK_KEYS, deadWatermark, {
            status: 'dead_letter',
            batchSize: 1,
            error: errorDetail,
          });
        });

        return { committed: 0, deadLettered: 1, advancedWatermark: deadWatermark };
      }

      // Bisect into two halves and recurse.
      const mid = Math.floor(subBatch.messages.length / 2);
      const leftMessages = subBatch.messages.slice(0, mid);
      const rightMessages = subBatch.messages.slice(mid);

      const leftConvIds = new Set(leftMessages.map((m) => m.conversation_id).filter(Boolean));
      const rightConvIds = new Set(rightMessages.map((m) => m.conversation_id).filter(Boolean));
      const leftAgentIds = new Set(leftMessages.map((m) => m.model_or_agent_id).filter(Boolean));
      const rightAgentIds = new Set(rightMessages.map((m) => m.model_or_agent_id).filter(Boolean));

      const leftBatch: EnrichedBatch = {
        messages: leftMessages,
        conversations: subBatch.conversations.filter((c) => leftConvIds.has(c.conversation_id)),
        agents: subBatch.agents.filter((a) => leftAgentIds.has(a.agent_id)),
      };

      const rightBatch: EnrichedBatch = {
        messages: rightMessages,
        conversations: subBatch.conversations.filter((c) => rightConvIds.has(c.conversation_id)),
        agents: subBatch.agents.filter((a) => rightAgentIds.has(a.agent_id)),
      };

      const leftResult = await attempt(leftBatch, currentWatermark, depth + 1);
      const rightResult = await attempt(rightBatch, leftResult.advancedWatermark, depth + 1);

      return {
        committed: leftResult.committed + rightResult.committed,
        deadLettered: leftResult.deadLettered + rightResult.deadLettered,
        advancedWatermark: rightResult.advancedWatermark,
      };
    }
  };

  const result = await attempt(batch, watermark, 0);
  bisectMetrics?.bisectionMaxDepthObserved.set(maxDepthObserved);
  return result;
}

// ---- Erasure metrics interface (CRI-04) ----

export type ErasureMetrics = {
  errorsTotal: { labels: (phase: string) => { inc: (n?: number) => void } };
  erasureChunkDeletedRatio: { observe: (value: number) => void };
};

// ---- Erasure reconciliation ----

export async function runErasureReconciliation(
  client: pg.Client,
  mongoClient: MongoClient,
  retentionMonths: number,
  logger: PinoLogger,
  erasureSafetyMinChunk = 100,
  erasureMetrics?: ErasureMetrics,
): Promise<{ erasureDeletions: number; retentionDeletions: number }> {
  const CHUNK_SIZE = 1000;
  let erasureDeletions = 0;
  let retentionDeletions = 0;

  // CRI-07: keyset pagination on id to avoid OFFSET skipping after deletions.
  let lastId = 0;

  for (;;) {
    const chunk = await client.query<{ id: number; message_id: string; user_id: string; conversation_id: string | null }>(
      `SELECT id, message_id, user_id, conversation_id FROM messages_log
       WHERE id > $1 ORDER BY id LIMIT $2`,
      [lastId, CHUNK_SIZE],
    );

    if (chunk.rows.length === 0) break;

    // Track lastId BEFORE any deletions so the cursor is stable.
    const lastRow = chunk.rows[chunk.rows.length - 1];
    lastId = lastRow !== undefined ? lastRow.id : lastId;

    const messageIds = chunk.rows.map((r) => r.message_id);

    // CRI-04: add maxTimeMS to protect against Mongo connectivity blips.
    const stillPresent = await mongoClient
      .db('LibreChat')
      .collection('messages')
      .find(
        { messageId: { $in: messageIds } },
        { projection: { messageId: 1 }, maxTimeMS: 60000 },
      )
      .toArray();

    const presentSet = new Set(stillPresent.map((d) => String(d['messageId'])));
    const toDelete = messageIds.filter((id) => !presentSet.has(id));

    // CRI-04: safety check — abort chunk if Mongo returned suspiciously empty results.
    if (messageIds.length > erasureSafetyMinChunk) {
      const deletionRatio = toDelete.length / messageIds.length;

      if (stillPresent.length === 0) {
        logger.error(
          { phase: 'erasure_safety_abort', chunkSize: messageIds.length },
          'Erasure safety abort: Mongo returned 0 results for a large chunk — possible connectivity blip',
        );
        erasureMetrics?.errorsTotal.labels('erasure_safety_abort').inc();
        erasureMetrics?.erasureChunkDeletedRatio.observe(0);
        continue;
      }

      if (deletionRatio > 0.5) {
        logger.error(
          { phase: 'erasure_safety_abort', chunkSize: messageIds.length, deletionRatio },
          'Erasure safety abort: deletion ratio exceeds 0.5 threshold',
        );
        erasureMetrics?.errorsTotal.labels('erasure_safety_abort').inc();
        erasureMetrics?.erasureChunkDeletedRatio.observe(deletionRatio);
        continue;
      }

      erasureMetrics?.erasureChunkDeletedRatio.observe(deletionRatio);
    }

    if (toDelete.length > 0) {
      await withTransaction(client, async (txn) => {
        await txn.client.query(
          `DELETE FROM guardrail_events_log WHERE message_id = ANY($1)`,
          [toDelete],
        );
        await txn.client.query(
          `DELETE FROM messages_log WHERE message_id = ANY($1)`,
          [toDelete],
        );
        // Remove conversations that no longer have any messages.
        const orphanConvIds = [
          ...new Set(
            chunk.rows
              .filter((r) => toDelete.includes(r.message_id) && r.conversation_id != null)
              .map((r) => r.conversation_id as string),
          ),
        ];
        if (orphanConvIds.length > 0) {
          await txn.client.query(
            `DELETE FROM conversations_dim WHERE conversation_id = ANY($1)
               AND NOT EXISTS (
                 SELECT 1 FROM messages_log WHERE conversation_id = conversations_dim.conversation_id
               )`,
            [orphanConvIds],
          );
        }
      });

      erasureDeletions += toDelete.length;
      logger.info({ phase: 'reconciliation', batchSize: toDelete.length }, 'Erasure deletions committed');
    }
  }

  // Retention ceiling — paged, transactional, with cascading guardrail_events_log cleanup.
  for (;;) {
    let pageCount = 0;
    await withTransaction(client, async (txn) => {
      // Identify the next page of expired messages.
      const expiredPage = await txn.client.query<{ message_id: string; conversation_id: string | null }>(
        `SELECT message_id, conversation_id FROM messages_log
         WHERE source_created_at < NOW() - ($1 || ' months')::INTERVAL
         LIMIT $2`,
        [retentionMonths, CHUNK_SIZE],
      );

      if (expiredPage.rows.length === 0) {
        pageCount = 0;
        return;
      }

      const expiredIds = expiredPage.rows.map((r) => r.message_id);

      // Cascade: delete guardrail events for expired messages.
      await txn.client.query(
        `DELETE FROM guardrail_events_log WHERE message_id = ANY($1)`,
        [expiredIds],
      );

      // Delete expired messages.
      await txn.client.query(
        `DELETE FROM messages_log WHERE message_id = ANY($1)`,
        [expiredIds],
      );

      // Remove conversations that no longer have any surviving messages.
      const orphanConvIds = [
        ...new Set(
          expiredPage.rows
            .filter((r) => r.conversation_id != null)
            .map((r) => r.conversation_id as string),
        ),
      ];
      if (orphanConvIds.length > 0) {
        await txn.client.query(
          `DELETE FROM conversations_dim WHERE conversation_id = ANY($1)
             AND NOT EXISTS (
               SELECT 1 FROM messages_log WHERE conversation_id = conversations_dim.conversation_id
             )`,
          [orphanConvIds],
        );
      }

      pageCount = expiredIds.length;
    });

    if (pageCount === 0) break;

    retentionDeletions += pageCount;
    logger.info({ phase: 'reconciliation', batchSize: pageCount }, 'Retention ceiling deletions committed');
  }

  // Guardrail retention ceiling — independent of messages. Guardrail events whose
  // message_id never matched a real message (block-mode events, or events written
  // before the source join-key fix) are not caught by the message cascade above, so
  // they must be aged out on their own timestamp. COALESCE(source_created_at,
  // synced_at) guarantees rows with a missing source timestamp are still eligible.
  for (;;) {
    let pageCount = 0;
    await withTransaction(client, async (txn) => {
      const expired = await txn.client.query<{ event_id: string }>(
        `SELECT event_id FROM guardrail_events_log
         WHERE COALESCE(source_created_at, synced_at) < NOW() - ($1 || ' months')::INTERVAL
         LIMIT $2`,
        [retentionMonths, CHUNK_SIZE],
      );

      if (expired.rows.length === 0) {
        pageCount = 0;
        return;
      }

      const expiredEventIds = expired.rows.map((r) => r.event_id);
      await txn.client.query(
        `DELETE FROM guardrail_events_log WHERE event_id = ANY($1)`,
        [expiredEventIds],
      );
      pageCount = expiredEventIds.length;
    });

    if (pageCount === 0) break;

    retentionDeletions += pageCount;
    logger.info(
      { phase: 'reconciliation', batchSize: pageCount },
      'Guardrail retention ceiling deletions committed',
    );
  }

  return { erasureDeletions, retentionDeletions };
}
