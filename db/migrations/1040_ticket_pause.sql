-- t126: two more open ticket states for a ticket that is neither Andrés's turn nor Claude's: `paused` ("En pausa":
-- blocked on something else, with a reason and optionally the ticket it waits for, which resumes it when it closes)
-- and `ongoing` ("En proceso": going on with nobody active right now, e.g. CI or a third party).
-- pause_reason is required for both states, paused_until_ticket_id is optional (paused only), paused_at is when the
-- state was entered. All three are cleared whenever the ticket leaves paused/ongoing.
ALTER TABLE tickets ADD COLUMN pause_reason TEXT;
ALTER TABLE tickets ADD COLUMN paused_until_ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN paused_at TEXT;
CREATE INDEX tickets_paused_until ON tickets (paused_until_ticket_id);

-- `paused` and `ongoing` have to be allowed by the status CHECK. SQLite cannot alter a CHECK in place and rebuilding
-- tickets would cascade-delete every child table (foreign keys are on), so the CHECK text in the schema is rewritten
-- as in 0900_slack_drafts.sql and 1010_withdraw_close.sql (the documented "writable_schema" procedure; no stored row
-- changes). It runs after the ADD COLUMN statements, which locate the end of the column list by offset.
PRAGMA writable_schema = ON;
UPDATE sqlite_schema
   SET sql = replace(sql, '''working'',''closed'')', '''working'',''closed'',''paused'',''ongoing'')')
 WHERE type = 'table' AND name = 'tickets' AND instr(sql, '''paused''') = 0;
PRAGMA writable_schema = RESET;
