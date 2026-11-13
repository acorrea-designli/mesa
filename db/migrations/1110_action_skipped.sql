-- A plan step can be skipped (t169): `mesa ticket action <id> --state skipped` marks a step Claude decided not to do (it no
-- longer applies, someone else did it). A skipped step is final: it asks for no OK, is not pending and never blocks closing
-- its ticket. `skipped` has to be allowed by the state CHECK of planned_actions. SQLite cannot alter a CHECK in place and
-- rebuilding the table would drop its rows' ordering guarantees for nothing, so the CHECK text in the schema is rewritten
-- as in 1010_withdraw_close.sql (the documented "writable_schema" procedure; no stored row changes).
PRAGMA writable_schema = ON;
UPDATE sqlite_schema
   SET sql = replace(sql, '''done'',''failed'')', '''done'',''failed'',''skipped'')')
 WHERE type = 'table' AND name = 'planned_actions' AND instr(sql, '''skipped''') = 0;
PRAGMA writable_schema = RESET;
