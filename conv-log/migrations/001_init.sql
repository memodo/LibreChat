-- migrations/001_init.sql — conv-log destination schema (REQ-058)
--
-- Idempotent: all CREATE statements use IF NOT EXISTS.
-- The migration runner (src/postgres.ts) records application in schema_migrations
-- after this file executes successfully. Do not add the schema_migrations INSERT
-- here — the runner writes it with a computed checksum.

-- ---- migration tracking ----

CREATE TABLE IF NOT EXISTS schema_migrations (
  version       TEXT        NOT NULL,
  applied_at    TIMESTAMPTZ NOT NULL,
  checksum      TEXT        NOT NULL,
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
);

-- ---- dimension tables ----

-- Type-1 SCD: ON CONFLICT DO UPDATE keeps the row current (no history).
-- Joins: messages_log.conversation_id -> conversations_dim.conversation_id
CREATE TABLE IF NOT EXISTS conversations_dim (
  conversation_id  TEXT        NOT NULL,
  title            TEXT,
  agent_id         TEXT,
  endpoint         TEXT,
  user_id          TEXT,
  archived         BOOLEAN,
  tags             JSONB,
  source_created_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  dim_updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  schema_version   INT         NOT NULL DEFAULT 1,
  CONSTRAINT conversations_dim_pkey PRIMARY KEY (conversation_id)
);

-- Type-1 SCD: ON CONFLICT DO UPDATE refreshes name/model on every batch that
-- references the agent (documented in REQ-064 and docs/field-mapping.md).
CREATE TABLE IF NOT EXISTS agents_dim (
  agent_id          TEXT        NOT NULL,
  name              TEXT,
  model_underlying  TEXT,
  description       TEXT,
  last_seen_at      TIMESTAMPTZ,
  dim_updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  schema_version    INT         NOT NULL DEFAULT 1,
  CONSTRAINT agents_dim_pkey PRIMARY KEY (agent_id)
);

-- ---- fact table ----

CREATE TABLE IF NOT EXISTS messages_log (
  id                BIGSERIAL   NOT NULL,
  message_id        TEXT        NOT NULL,
  user_id           TEXT        NOT NULL,
  conversation_id   TEXT,
  parent_message_id TEXT,
  sender            TEXT,
  endpoint          TEXT,
  model_or_agent_id TEXT,
  is_user           BOOLEAN,
  text              TEXT,
  content           JSONB,
  token_count       INT,
  error             BOOLEAN,
  unfinished        BOOLEAN,
  has_attachments   BOOLEAN,
  has_files         BOOLEAN,
  feedback_rating   TEXT,
  feedback_tag      JSONB,
  feedback_text     TEXT,
  source_created_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  schema_version    INT         NOT NULL DEFAULT 1,
  CONSTRAINT messages_log_pkey PRIMARY KEY (id),
  CONSTRAINT messages_log_uq UNIQUE (message_id, user_id),
  CONSTRAINT messages_log_conversation_fk
    FOREIGN KEY (conversation_id) REFERENCES conversations_dim(conversation_id)
    ON DELETE SET NULL
);

-- Indexes on messages_log (REQ-058). IF NOT EXISTS prevents re-run failures.
CREATE INDEX IF NOT EXISTS messages_log_source_created_at_idx
  ON messages_log (source_created_at);

CREATE INDEX IF NOT EXISTS messages_log_conversation_created_idx
  ON messages_log (conversation_id, source_created_at);

CREATE INDEX IF NOT EXISTS messages_log_model_agent_idx
  ON messages_log (model_or_agent_id);

CREATE INDEX IF NOT EXISTS messages_log_user_idx
  ON messages_log (user_id);

CREATE INDEX IF NOT EXISTS messages_log_parent_idx
  ON messages_log (parent_message_id);

-- ---- guardrail events (SPEC-009 join, REQ-058) ----

-- No FK to messages_log: timing not guaranteed (REQ-058 rationale).
-- message_id whose parent message has not yet synced stores loose; reconciled
-- on next pass.
CREATE TABLE IF NOT EXISTS guardrail_events_log (
  event_id          TEXT        NOT NULL,
  message_id        TEXT,
  user_id           TEXT,
  conversation_id   TEXT,
  route             TEXT,
  entity_types      JSONB,
  entity_count      INT,
  source_created_at TIMESTAMPTZ,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT guardrail_events_log_pkey PRIMARY KEY (event_id)
);

-- ---- dead-letter (REQ-074) ----

CREATE TABLE IF NOT EXISTS dead_letter_log (
  id                 BIGSERIAL   NOT NULL,
  source_collection  TEXT        NOT NULL,
  source_id          TEXT        NOT NULL,
  raw                JSONB,
  error_phase        TEXT        NOT NULL,
  error_detail       TEXT,
  first_failed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retry_count        INT         NOT NULL DEFAULT 1,
  CONSTRAINT dead_letter_log_pkey PRIMARY KEY (id)
);

-- ---- watermark and run-state (REQ-059) ----

CREATE TABLE IF NOT EXISTS sync_state (
  key        TEXT        NOT NULL,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sync_state_pkey PRIMARY KEY (key)
);
