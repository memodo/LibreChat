-- migrations/002_dead_letter_unique.sql
--
-- Adds a UNIQUE constraint on (source_collection, source_id) in dead_letter_log
-- so that the ON CONFLICT upsert in src/postgres.ts runDeadLetter() can target
-- a specific conflict target rather than the BIGSERIAL PK.
--
-- 001_init.sql created dead_letter_log with only a BIGSERIAL PK, making
-- conflict-based upsert impossible without this constraint.
--
-- Idempotent: a DO block checks information_schema before adding the constraint.
-- Postgres does not support ADD CONSTRAINT IF NOT EXISTS (not a valid syntax in
-- any PG version through PG 16); the DO block is the correct idempotent pattern.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'dead_letter_log_source_unique'
      AND table_name = 'dead_letter_log'
  ) THEN
    ALTER TABLE dead_letter_log
      ADD CONSTRAINT dead_letter_log_source_unique
      UNIQUE (source_collection, source_id);
  END IF;
END;
$$;
