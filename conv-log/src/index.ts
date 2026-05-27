import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { pino } from 'pino';
import type { Logger as PinoLogger } from 'pino';
import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import * as mongo from './mongo.js';
import * as postgres from './postgres.js';
import * as watermark from './watermark.js';
import { enrich } from './enrich.js';

// ---- Schema version ----
// Increment only when a migration requires truncate-and-rebuild per REQ-071.
const SCHEMA_VERSION = 1;

// ---- Config ----

type Config = {
  mongoUri: string;
  pgUri: string;
  intervalSeconds: number;
  backfillIntervalSeconds: number;
  backfillEnterThreshold: number;
  backfillExitHysteresisMultiplier: number;
  batchSize: number;
  initialWatermark: 'epoch' | 'now';
  mongoQueryTimeoutMs: number;
  pgStatementTimeoutMs: number;
  cacheSize: number;
  cacheTtlSeconds: number;
  watermarkSafetySeconds: number;
  maxBackoffSeconds: number;
  erasureReconciliationHours: number;
  retentionMonths: number;
  erasureSafetyMinChunk: number;
  logLevel: string;
};

function loadConfig(): Config {
  const required = (name: string): string => {
    const val = process.env[name];
    if (val == null || val === '') throw new Error(`Required env var ${name} is missing`);
    return val;
  };

  const optInt = (name: string, def: number): number => {
    const val = process.env[name];
    if (val == null || val === '') return def;
    const parsed = parseInt(val, 10);
    if (Number.isNaN(parsed)) throw new Error(`Env var ${name} must be an integer, got: ${val}`);
    return parsed;
  };

  const optFloat = (name: string, def: number): number => {
    const val = process.env[name];
    if (val == null || val === '') return def;
    const parsed = parseFloat(val);
    if (Number.isNaN(parsed)) throw new Error(`Env var ${name} must be a number, got: ${val}`);
    return parsed;
  };

  return {
    mongoUri: required('CONVLOG_MONGO_URI'),
    pgUri: required('CONVLOG_PG_URI'),
    intervalSeconds: optInt('CONVLOG_INTERVAL_SECONDS', 300),
    backfillIntervalSeconds: optInt('CONVLOG_BACKFILL_INTERVAL_SECONDS', 5),
    // CRI-06: renamed from backfillExitThreshold — this is now the ENTER threshold.
    backfillEnterThreshold: optInt('CONVLOG_BACKFILL_EXIT_THRESHOLD', 5),
    // CRI-06: hysteresis multiplier for backfill exit (exit when pending < enter * multiplier).
    backfillExitHysteresisMultiplier: optFloat('CONVLOG_BACKFILL_EXIT_THRESHOLD_MULTIPLIER', 0.5),
    batchSize: optInt('CONVLOG_BATCH_SIZE', 500),
    initialWatermark: process.env['CONVLOG_INITIAL_WATERMARK'] === 'now' ? 'now' : 'epoch',
    mongoQueryTimeoutMs: optInt('CONVLOG_MONGO_QUERY_TIMEOUT_MS', 30000),
    pgStatementTimeoutMs: optInt('CONVLOG_PG_STATEMENT_TIMEOUT_MS', 60000),
    cacheSize: optInt('CONVLOG_CACHE_SIZE', 1000),
    cacheTtlSeconds: optInt('CONVLOG_CACHE_TTL_SECONDS', 3600),
    watermarkSafetySeconds: optInt('CONVLOG_WATERMARK_SAFETY_SECONDS', 60),
    maxBackoffSeconds: optInt('CONVLOG_MAX_BACKOFF_SECONDS', 1800),
    erasureReconciliationHours: optInt('CONVLOG_ERASURE_RECONCILIATION_HOURS', 24),
    retentionMonths: optInt('CONVLOG_RETENTION_MONTHS', 24),
    // CRI-04: minimum chunk size below which the erasure safety ratio check is skipped.
    erasureSafetyMinChunk: optInt('CONVLOG_ERASURE_SAFETY_MIN_CHUNK', 100),
    logLevel: process.env['CONVLOG_LOG_LEVEL'] ?? 'info',
  };
}

// ---- Prometheus metrics ----

function buildMetrics(registry: Registry) {
  return {
    messagesSyncedTotal: new Counter({
      name: 'convlog_messages_synced_total',
      help: 'Total messages_log rows successfully upserted since process start.',
      registers: [registry],
    }),
    syncLagSeconds: new Gauge({
      name: 'convlog_sync_lag_seconds',
      help: 'Seconds since the last successful tick completed (now - last_successful_tick_start).',
      registers: [registry],
    }),
    pendingMessages: new Gauge({
      name: 'convlog_pending_messages',
      help: 'Count of Mongo messages with createdAt > current watermark, sampled each tick.',
      registers: [registry],
    }),
    maxMessageAgeSeconds: new Gauge({
      name: 'convlog_max_message_age_seconds',
      help: 'Age in seconds of the most recent message in messages_log (now - MAX(source_created_at)).',
      registers: [registry],
    }),
    errorsTotal: new Counter({
      name: 'convlog_errors_total',
      help: 'Error count by phase.',
      labelNames: ['phase'] as const,
      registers: [registry],
    }),
    deadLetterTotal: new Counter({
      name: 'convlog_dead_letter_total',
      help: 'Rows written to dead_letter_log by phase.',
      labelNames: ['phase'] as const,
      registers: [registry],
    }),
    lastRunUnixTimestamp: new Gauge({
      name: 'convlog_last_run_unix_timestamp',
      help: 'Unix timestamp of the most recent tick attempt (success or failure).',
      registers: [registry],
    }),
    batchDurationSeconds: new Histogram({
      name: 'convlog_batch_duration_seconds',
      help: 'Duration of each batch processing tick in seconds.',
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 120],
      registers: [registry],
    }),
    erasureDeletionsTotal: new Counter({
      name: 'convlog_erasure_deletions_total',
      help: 'Rows deleted by REQ-073 erasure reconciliation since process start.',
      registers: [registry],
    }),
    // CRI-04: per-chunk deletion ratio histogram for erasure safety monitoring.
    erasureChunkDeletedRatio: new Histogram({
      name: 'convlog_erasure_chunk_deleted_ratio',
      help: 'Fraction of messages_log rows deleted per erasure reconciliation chunk (0-1).',
      buckets: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0],
      registers: [registry],
    }),
    // CRI-09: max bisection depth gauge per outer call.
    bisectionMaxDepthObserved: new Gauge({
      name: 'convlog_bisection_max_depth_observed',
      help: 'Maximum recursion depth reached during the most recent bisectAndUpsert call.',
      registers: [registry],
    }),
  };
}

// ---- HTTP server ----

function startHttpServer(
  port: number,
  registry: Registry,
  getLastSuccessfulSyncAt: () => Date | null,
  intervalSeconds: number,
): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }

    if (req.url === '/healthz') {
      const last = getLastSuccessfulSyncAt();
      const lagThresholdMs = 3 * intervalSeconds * 1000;
      const healthy = last != null && Date.now() - last.getTime() < lagThresholdMs;
      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'text/plain' }).end(healthy ? 'ok' : 'degraded');
      return;
    }

    if (req.url === '/metrics') {
      const output = await registry.metrics();
      res.writeHead(200, { 'Content-Type': registry.contentType }).end(output);
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(port);
  return server;
}

// ---- Sleep helper ----

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Full jitter exponential backoff ----

const jitteredBackoff = (consecutiveFailures: number, maxMs: number): number => {
  const cap = maxMs * 1000;
  const base = 1000;
  const exponential = Math.min(cap, base * Math.pow(2, consecutiveFailures));
  return Math.random() * exponential;
};

// ---- Main ingestion loop ----

async function runIngestionLoop(
  pgClient: InstanceType<typeof pg.Client>,
  mongoClient: mongo.MongoClient,
  cfg: Config,
  metrics: ReturnType<typeof buildMetrics>,
  logger: PinoLogger,
  onSuccessfulSync: (at: Date) => void,
  isRunning: () => boolean,
): Promise<void> {
  let consecutiveFailures = 0;
  // CRI-06: two-threshold hysteresis state
  let inBackfillMode = false;
  let lastSuccessfulTickStartUnix = Date.now() / 1000;

  const backfillEnterThreshold = cfg.backfillEnterThreshold * cfg.batchSize;
  const backfillExitThreshold = backfillEnterThreshold * cfg.backfillExitHysteresisMultiplier;

  const bisectMetrics: postgres.BisectMetrics = {
    deadLetterTotal: metrics.deadLetterTotal,
    bisectionMaxDepthObserved: metrics.bisectionMaxDepthObserved,
  };

  for (;;) {
    if (!isRunning()) break;

    const tickStart = Date.now();
    const tickStartUnix = tickStart / 1000;
    metrics.lastRunUnixTimestamp.set(tickStartUnix);

    try {
      const wm = await watermark.readWatermark(pgClient, {
        defaultInitial: cfg.initialWatermark === 'now'
          ? new Date(Date.now() - cfg.watermarkSafetySeconds * 1000)
          : new Date(0),
      });

      const pending = await mongo.countPendingMessages(mongoClient, wm);
      metrics.pendingMessages.set(pending);

      // CRI-06: two-threshold hysteresis — enter and exit use different thresholds.
      if (!inBackfillMode && pending > backfillEnterThreshold) {
        inBackfillMode = true;
      } else if (inBackfillMode && pending < backfillExitThreshold) {
        inBackfillMode = false;
      }

      const batch = await mongo.assembleBatch(
        mongoClient,
        wm,
        cfg.batchSize,
        cfg.mongoQueryTimeoutMs,
        (docId) => {
          metrics.errorsTotal.labels('normalisation').inc();
          logger.warn({ phase: 'normalisation', docId }, 'Skipping malformed Mongo doc (missing messageId or invalid createdAt)');
        },
      );

      if (batch.messages.length > 0) {
        const enriched = enrich(batch, { schemaVersion: SCHEMA_VERSION, now: new Date() });

        const sourceDocs = new Map<string, unknown>(
          batch.messages.map((m) => [m.messageId, { messageId: m.messageId, conversationId: m.conversationId }]),
        );

        const result = await postgres.bisectAndUpsert(
          pgClient,
          enriched,
          sourceDocs,
          wm,
          logger,
          cfg.watermarkSafetySeconds,
          cfg.pgStatementTimeoutMs,
          bisectMetrics,
        );

        metrics.messagesSyncedTotal.inc(result.committed);
        if (result.deadLettered > 0) {
          metrics.deadLetterTotal.labels('postgres_upsert').inc(result.deadLettered);
        }
      }

      // CRI-05: mark success immediately after bisectAndUpsert returns (before telemetry query).
      consecutiveFailures = 0;
      lastSuccessfulTickStartUnix = tickStartUnix;
      onSuccessfulSync(new Date());

      // Telemetry query is auxiliary — failures here do NOT count as tick failures.
      try {
        const latestAgeResult = await pgClient.query<{ max: Date | null }>(
          `SELECT MAX(source_created_at) AS max FROM messages_log`,
        );
        const latestAt = latestAgeResult.rows[0]?.max;
        if (latestAt != null) {
          metrics.maxMessageAgeSeconds.set((Date.now() - new Date(latestAt).getTime()) / 1000);
        }
      } catch (telemetryErr) {
        metrics.errorsTotal.labels('telemetry').inc();
        logger.warn({ phase: 'telemetry', err: telemetryErr }, 'Telemetry query failed (tick still counted as success)');
      }
    } catch (err) {
      consecutiveFailures++;
      metrics.errorsTotal.labels('postgres_upsert').inc();
      logger.error({ phase: 'tick', batchSize: cfg.batchSize, err }, 'Tick failed');
    }

    metrics.batchDurationSeconds.observe((Date.now() - tickStart) / 1000);
    metrics.syncLagSeconds.set(Date.now() / 1000 - lastSuccessfulTickStartUnix);

    if (!isRunning()) break;

    const baseIntervalMs = inBackfillMode
      ? cfg.backfillIntervalSeconds * 1000
      : cfg.intervalSeconds * 1000;

    const sleepMs = consecutiveFailures >= 3
      ? jitteredBackoff(consecutiveFailures - 2, cfg.maxBackoffSeconds)
      : baseIntervalMs;

    await sleep(sleepMs);
  }
}

// ---- Erasure reconciliation loop ----

async function runErasureLoop(
  pgClient: InstanceType<typeof pg.Client>,
  mongoClient: mongo.MongoClient,
  cfg: Config,
  metrics: ReturnType<typeof buildMetrics>,
  logger: PinoLogger,
  isRunning: () => boolean,
): Promise<void> {
  // CRI-11: run first reconciliation near startup (60s settle delay) rather than
  // deferring the full 24h. Subsequent passes sleep 24h AFTER each run.
  await sleep(60_000);

  const erasureMetrics: postgres.ErasureMetrics = {
    errorsTotal: metrics.errorsTotal,
    erasureChunkDeletedRatio: metrics.erasureChunkDeletedRatio,
  };

  for (;;) {
    if (!isRunning()) break;

    try {
      // CRI-01: pgClient here is the dedicated reconciliation client (pgClientReconciliation).
      const result = await postgres.runErasureReconciliation(
        pgClient,
        mongoClient,
        cfg.retentionMonths,
        logger,
        cfg.erasureSafetyMinChunk,
        erasureMetrics,
      );
      metrics.erasureDeletionsTotal.inc(result.erasureDeletions + result.retentionDeletions);
      logger.info(
        { phase: 'reconciliation', batchSize: result.erasureDeletions + result.retentionDeletions },
        'Reconciliation complete',
      );
    } catch (err) {
      metrics.errorsTotal.labels('reconciliation').inc();
      logger.error({ phase: 'reconciliation', batchSize: 0, err }, 'Reconciliation failed');
      // Never rethrow — reconciliation failures must not block the main ingestion loop.
    }

    await sleep(cfg.erasureReconciliationHours * 3600 * 1000);
  }
}

// ---- Entrypoint ----

async function main(): Promise<void> {
  const cfg = loadConfig();
  // CRI-14: redact connection URIs so they never appear in logs.
  // fast-redact has no suffix wildcard (`*Uri` is invalid and throws at
  // construction) — paths must be whole segments, so enumerate the URI fields.
  const logger = pino({
    level: cfg.logLevel,
    redact: ['mongoUri', 'pgUri', '*.mongoUri', '*.pgUri'],
  });

  logger.info({ phase: 'startup' }, 'conv-log starting');

  const registry = new Registry();
  const metrics = buildMetrics(registry);

  // CRI-01: create two separate pg.Client instances — one for ingestion, one for
  // erasure reconciliation — so their transactions are fully isolated.
  const pgClient = postgres.createPgClient(cfg.pgUri, cfg.pgStatementTimeoutMs);
  await postgres.connectPgClient(pgClient);

  // CRI-08: register error handlers on pg clients immediately after connect.
  pgClient.on('error', (err) => {
    logger.error(
      { phase: 'pg_client_error', err: { message: err.message, code: (err as { code?: string }).code } },
      'pg ingestion client error',
    );
    metrics.errorsTotal.labels('pg_client_error').inc();
  });

  const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  await postgres.runMigrations(pgClient, migrationsDir);
  logger.info({ phase: 'startup' }, 'Migrations complete');

  // CRI-01: dedicated reconciliation client — separate connection, separate transaction scope.
  const pgClientReconciliation = postgres.createPgClient(cfg.pgUri, cfg.pgStatementTimeoutMs);
  await postgres.connectPgClient(pgClientReconciliation);

  pgClientReconciliation.on('error', (err) => {
    logger.error(
      { phase: 'pg_reconcile_client_error', err: { message: err.message, code: (err as { code?: string }).code } },
      'pg reconciliation client error',
    );
    metrics.errorsTotal.labels('pg_reconcile_client_error').inc();
  });

  const mongoClient = mongo.createMongoClient(cfg.mongoUri, { queryTimeoutMs: cfg.mongoQueryTimeoutMs });
  await mongoClient.connect();

  // CRI-08: mongo connection error handler.
  mongoClient.on('error', (err: Error) => {
    logger.error(
      { phase: 'mongo_client_error', err: { message: err.message } },
      'mongo client error',
    );
    metrics.errorsTotal.labels('mongo_client_error').inc();
  });

  mongo.configureCache({ capacity: cfg.cacheSize, ttlSeconds: cfg.cacheTtlSeconds });

  // CRI-10: startup pre-flight check for guardrailevents collection.
  const guardrailCollectionName = mongo.GUARDRAIL_COLLECTION;
  const guardrailCollections = await mongoClient
    .db('LibreChat')
    .listCollections({ name: guardrailCollectionName })
    .toArray();
  if (guardrailCollections.length === 0) {
    logger.warn(
      { phase: 'config_guardrail_missing', collection: guardrailCollectionName },
      `Guardrail collection "${guardrailCollectionName}" not found in LibreChat database. ` +
      `PII-trigger correlation queries will return empty until the collection exists. ` +
      `Verify collection name via: mongosh '<MONGO_URI>' --eval 'db.getCollectionNames()'`,
    );
    metrics.errorsTotal.labels('config_guardrail_missing').inc();
  }

  let lastSuccessfulSyncAt: Date | null = null;
  let running = true;

  const server = startHttpServer(
    9300,
    registry,
    () => lastSuccessfulSyncAt,
    cfg.intervalSeconds,
  );

  logger.info({ phase: 'startup' }, 'HTTP server listening on port 9300');

  const shutdown = async (): Promise<void> => {
    if (!running) return;
    running = false;
    logger.info({ phase: 'shutdown' }, 'Shutting down');
    // CRI-12: await server.close() properly so in-flight scrapes complete.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pgClient.end();
    await pgClientReconciliation.end();
    await mongoClient.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // CRI-01: pass dedicated clients to each loop — ingestion gets pgClient,
  // erasure gets pgClientReconciliation. Transactions are fully isolated.
  await Promise.all([
    runIngestionLoop(
      pgClient,
      mongoClient,
      cfg,
      metrics,
      logger,
      (at) => { lastSuccessfulSyncAt = at; },
      () => running,
    ),
    runErasureLoop(pgClientReconciliation, mongoClient, cfg, metrics, logger, () => running),
  ]);
}

main().catch((err) => {
  // CRI-14: avoid serializing the full error object which may contain connection URIs in stacks.
  process.stderr.write(`startup failure: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
