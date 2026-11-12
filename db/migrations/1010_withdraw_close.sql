-- The lead can clear stale leftovers (t123): `mesa salida withdraw <id> --reason R` closes a pending or draft salida
-- without ever sending it (new final status `withdrawn`, with its own reason and time), and `mesa review close
-- <id> --reason R` closes an open review card (new state `closed`, with its own reason and time). Neither is a deny
-- and neither is Andrés's press: they never count as his interaction.
ALTER TABLE salidas ADD COLUMN withdraw_reason TEXT;
ALTER TABLE salidas ADD COLUMN withdrawn_at TEXT;
ALTER TABLE reviews ADD COLUMN close_reason TEXT;
ALTER TABLE reviews ADD COLUMN closed_at TEXT;

-- `withdrawn` and `closed` have to be allowed by the status / state CHECKs. SQLite cannot alter a CHECK in place and
-- rebuilding salidas or reviews would cascade-delete their children (foreign keys are on), so the CHECK text in the
-- schema is rewritten as in 0900_slack_drafts.sql (the documented "writable_schema" procedure; no stored row changes).
-- It runs after the ADD COLUMN statements, which locate the end of the column list by offset.
PRAGMA writable_schema = ON;
UPDATE sqlite_schema
   SET sql = replace(sql, '''draft_created''))', '''draft_created'',''withdrawn''))')
 WHERE type = 'table' AND name = 'salidas' AND instr(sql, '''withdrawn''') = 0;
UPDATE sqlite_schema
   SET sql = replace(sql, '''open'',''approving'',''approved'')', '''open'',''approving'',''approved'',''closed'')')
 WHERE type = 'table' AND name = 'reviews' AND instr(sql, '''closed''') = 0;
PRAGMA writable_schema = RESET;
