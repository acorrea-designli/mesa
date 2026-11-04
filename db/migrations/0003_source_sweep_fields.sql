-- Sweeper fields asked for by the team layer (scripts/sweep-tick.mjs): error tracking and
-- the last time Andres touched the UI (snaps the sweep cadence back to 60 s).
ALTER TABLE source_state RENAME COLUMN last_checked_at TO last_checked;
ALTER TABLE source_state ADD COLUMN error_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_state ADD COLUMN last_error TEXT;
