-- Slack salidas go out in one of two modes Andrés picks with his approval click (send_mode): "draft" (default;
-- the lead leaves the text as a Slack draft and Andrés presses send himself) or "send" (Claude sends it through
-- the connector, which adds "Sent using @Claude"). A draft-mode salida that reached Slack waits in the new status
-- draft_created until Andrés says "Ya lo envié" (drafted_at: when the draft was created). Non-Slack salidas have no mode.
ALTER TABLE salidas ADD COLUMN send_mode TEXT CHECK (send_mode IN ('draft','send'));
ALTER TABLE salidas ADD COLUMN drafted_at TEXT;

-- draft_created has to be allowed by the status CHECK. SQLite cannot alter a CHECK in place, and rebuilding the
-- table would cascade-delete salida_turns and salida_versions (foreign keys are on), so the CHECK text in the
-- schema is rewritten (the documented "writable_schema" procedure; no stored row changes). It runs after the
-- ADD COLUMN statements, which locate the end of the column list by offset, and RESET reloads the schema so the
-- new CHECK is live in this connection too.
PRAGMA writable_schema = ON;
UPDATE sqlite_schema
   SET sql = replace(sql, '''queued_until_back'',''deleted'')', '''queued_until_back'',''deleted'',''draft_created'')')
 WHERE type = 'table' AND name = 'salidas';
PRAGMA writable_schema = RESET;
