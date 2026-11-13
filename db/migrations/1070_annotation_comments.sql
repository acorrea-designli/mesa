-- General comments in the PDF review editor (t147). Andrés can leave a comment that is not tied to a text selection or a
-- shape: a new pageless kind `comment` (geometry {}), page 0 = the whole document, page N = that page.
-- `kind` and `page` have CHECKs (1030) that have to allow it. SQLite cannot alter a CHECK in place and rebuilding
-- `annotations` would cascade-delete its replies (annotation_replies references it with ON DELETE CASCADE and foreign
-- keys are on), so the CHECK text in the schema is rewritten as in 1010_withdraw_close.sql (the documented
-- "writable_schema" procedure; no stored row changes). Each rewrite is guarded so it runs once.
PRAGMA writable_schema = ON;
UPDATE sqlite_schema
   SET sql = replace(sql, 'CHECK (page >= 1)', 'CHECK (page >= 0)')
 WHERE type = 'table' AND name = 'annotations' AND instr(sql, 'CHECK (page >= 1)') > 0;
UPDATE sqlite_schema
   SET sql = replace(sql, '''ellipse'',''arrow''))', '''ellipse'',''arrow'',''comment''))')
 WHERE type = 'table' AND name = 'annotations' AND instr(sql, '''comment''') = 0;
PRAGMA writable_schema = RESET;
