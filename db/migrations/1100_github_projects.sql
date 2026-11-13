-- /proyectos (t152): a read-only cache of the client GitHub Projects in config/projects.json. The reader
-- (src/lib/integrations/projects-reader.ts) fills it from GitHub on its own cadence; the screen and its API read only
-- these tables, never GitHub on request. Mesa never writes to those repos or boards.

-- One row per open PR of a configured repo. The list read (REST, conditional) owns the first block; the detail read
-- (one batched GraphQL query) owns the second and records the head and updated_at it was taken at, so it is redone
-- only when the PR moved (or while its checks or mergeability are still settling). A PR that leaves the open list is
-- deleted with its repo's next complete read.
CREATE TABLE gh_open_prs (
  repo              TEXT NOT NULL,              -- owner/name as configured
  number            INTEGER NOT NULL,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  author            TEXT NOT NULL DEFAULT '',
  draft             INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  head_sha          TEXT NOT NULL DEFAULT '',
  head_ref          TEXT NOT NULL DEFAULT '',
  base_ref          TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL DEFAULT '',   -- first 8000 characters, for issue references only
  requested         TEXT NOT NULL DEFAULT '[]', -- JSON logins requested as reviewers
  mergeable         TEXT,                       -- MERGEABLE | CONFLICTING | UNKNOWN; NULL before the detail read
  checks_state      TEXT,                       -- pass | fail | pending | none; NULL before the detail read
  checks_total      INTEGER NOT NULL DEFAULT 0,
  checks_failed     INTEGER NOT NULL DEFAULT 0,
  checks_pending    INTEGER NOT NULL DEFAULT 0,
  review_decision   TEXT,                       -- APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED
  my_review         TEXT,                       -- Andrés's latest review on GitHub (APPROVED, COMMENTED, ...)
  closing_issues    TEXT NOT NULL DEFAULT '[]', -- JSON ["owner/repo#n"] the PR closes
  detail_head       TEXT,
  detail_updated_at TEXT,
  detail_at         TEXT,
  seen_at           TEXT NOT NULL,
  PRIMARY KEY (repo, number)
);

-- The last good list read per repo: its ETag (If-None-Match makes an unchanged list a free 304) and its time, which
-- the screen shows as "Leído de GitHub · hace N min". A failed read leaves the row (and the PRs) as they were.
CREATE TABLE gh_repo_reads (
  repo       TEXT PRIMARY KEY,
  etag       TEXT,
  read_at    TEXT NOT NULL,
  pr_count   INTEGER NOT NULL DEFAULT 0,
  truncated  INTEGER NOT NULL DEFAULT 0       -- 1 when the repo has more open PRs than one page (100)
);

-- One row per configured board (config key), with its Status options in board order.
CREATE TABLE gh_boards (
  project        TEXT PRIMARY KEY,
  owner          TEXT NOT NULL,
  number         INTEGER NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  url            TEXT NOT NULL DEFAULT '',
  status_options TEXT NOT NULL DEFAULT '[]',   -- JSON names, board order
  item_count     INTEGER NOT NULL DEFAULT 0,
  read_at        TEXT NOT NULL
);

-- The board's items, replaced as a whole on every complete board read.
CREATE TABLE gh_board_items (
  project      TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  content_type TEXT NOT NULL,                 -- Issue | PullRequest | DraftIssue
  repo         TEXT,                          -- owner/name of the issue or PR; NULL for a draft
  number       INTEGER,
  title        TEXT NOT NULL DEFAULT '',
  url          TEXT,
  state        TEXT,                          -- OPEN | CLOSED | MERGED
  status       TEXT,                          -- the Status column; NULL = "Sin estado"
  linked_prs   TEXT NOT NULL DEFAULT '[]',    -- JSON PR URLs of the "Linked pull requests" field
  PRIMARY KEY (project, item_id)
);
CREATE INDEX gh_board_items_content ON gh_board_items (project, repo, number);

-- The reader's health row "github_projects" (rail notice, Estados B) needs the new source in the source_state CHECK.
-- SQLite cannot alter a CHECK in place, so the CHECK text is rewritten as in 1000_calendar.sql (the documented
-- writable_schema procedure; no stored row changes).
PRAGMA writable_schema = ON;
UPDATE sqlite_schema
   SET sql = replace(sql, '''engram'',''calendar'')', '''engram'',''calendar'',''github_projects'')')
 WHERE type = 'table' AND name = 'source_state' AND instr(sql, '''github_projects''') = 0;
PRAGMA writable_schema = RESET;
