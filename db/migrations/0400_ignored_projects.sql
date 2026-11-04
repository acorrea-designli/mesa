-- Projects Andrés chose to ignore ("Ignorar proyecto"). Ingest skips them, and Hoy, the band
-- counts and Tablero filter their items and tasks out by query: nothing is deleted or flagged,
-- so un-ignoring (deleting the row) brings everything back as it was. Salidas are never
-- filtered (an outgoing message still needs a decision).
--
-- source is one of the four sources, or '*' for the project in every source.
-- project is the project key (see project_key below): GitHub owner/repo, Slack channel id,
-- Basecamp project name, Claude project. A row also matches an item whose plain project
-- column equals it, so a short GitHub repo name typed by hand still works.
CREATE TABLE ignored_projects (
  id         TEXT PRIMARY KEY,
  source     TEXT NOT NULL CHECK (source IN ('github','slack','basecamp','claude','*')),
  project    TEXT NOT NULL CHECK (project <> ''),
  label      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (source, project)
);

-- The most specific stable project id of an item, derived from its dedupe key. Keep in sync
-- with projectKey() in src/lib/domain/ignore.ts (a test checks they agree).
--   github: externalId [prefix]pr:<owner>/<repo>#<n> -> <owner>/<repo>
--   slack:  externalId [prefix]<channelId>:<ts>      -> <channelId> (the segment before the last ':')
--   else, or when the key cannot be read:             the project column
-- rtrim(s, replace(s, ':', '')) cuts s after its last ':' (SQLite has no reverse instr).
ALTER TABLE items ADD COLUMN project_key TEXT GENERATED ALWAYS AS (
  CASE
    WHEN source = 'github' AND instr(external_id, 'pr:') > 0 AND instr(substr(external_id, instr(external_id, 'pr:') + 3), '#') > 1
      THEN substr(substr(external_id, instr(external_id, 'pr:') + 3), 1, instr(substr(external_id, instr(external_id, 'pr:') + 3), '#') - 1)
    WHEN source = 'slack' AND instr(external_id, ':') > 0
      THEN COALESCE(NULLIF(substr(substr(external_id, 1, length(rtrim(external_id, replace(external_id, ':', ''))) - 1), length(rtrim(substr(external_id, 1, length(rtrim(external_id, replace(external_id, ':', ''))) - 1), replace(substr(external_id, 1, length(rtrim(external_id, replace(external_id, ':', ''))) - 1), ':', ''))) + 1), ''), project)
    ELSE project
  END
) VIRTUAL;
CREATE INDEX items_project_key ON items (source, project_key);
