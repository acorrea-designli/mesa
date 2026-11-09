-- "Saltar" on Hoy: an item Andrés does not want to act on. Skipping marks it done with waitOn none and stamps
-- skipped_at; an upsert of the same (source, external_id) never reopens it (items.upsert, GitHub review sync).
-- A move to a non-done station, or Deshacer (unskip), clears it. NULL for every item that was not skipped.
ALTER TABLE items ADD COLUMN skipped_at TEXT;
