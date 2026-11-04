-- Ephemeral agents (briefs, handoffs, team), permission approvals, PR reviews, source health.
-- No state may live only in an agent's context window: everything a fresh agent needs to
-- resume a ticket is in these tables (see GET /api/tickets/:id/context).

-- The living summary of a ticket, rewritten by its owner on every milestone.
CREATE TABLE ticket_briefs (
  ticket_id      TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  body           TEXT NOT NULL DEFAULT '',     -- Markdown summary
  goal           TEXT NOT NULL DEFAULT '',
  decisions      TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  plan_step      TEXT NOT NULL DEFAULT '',     -- current plan step
  open_questions TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  next_action    TEXT NOT NULL DEFAULT '',
  revision       INTEGER NOT NULL DEFAULT 0,
  updated_by     TEXT NOT NULL DEFAULT '',
  updated_at     TEXT NOT NULL
);

-- Append-only checkpoints / handoffs.
CREATE TABLE ticket_handoffs (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  agent       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL CHECK (status IN ('done','paused','blocked')),
  body        TEXT NOT NULL DEFAULT '',
  done        TEXT NOT NULL DEFAULT '',  -- what was done
  remaining   TEXT NOT NULL DEFAULT '',  -- what is left
  artifacts   TEXT NOT NULL DEFAULT '{}', -- JSON {branch?, pr?, files?: string[], ...}
  created_at  TEXT NOT NULL
);
CREATE INDEX ticket_handoffs_ticket ON ticket_handoffs (ticket_id, created_at);
CREATE INDEX ticket_handoffs_agent ON ticket_handoffs (agent, created_at);

-- Agents attached to a ticket. Names are <role>-<ticketRef>[-k] and are never reused.
CREATE TABLE ticket_team (
  name        TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  owner       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','retired')),
  spawned_at  TEXT NOT NULL,
  retired_at  TEXT
);
CREATE INDEX ticket_team_ticket ON ticket_team (ticket_id, status);

-- Permission approvals filed by the PermissionRequest hook (scripts/hooks/mesa-approval.mjs).
CREATE TABLE approvals (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT REFERENCES tickets(id) ON DELETE SET NULL, -- NULL: shown on Hoy
  agent       TEXT NOT NULL,
  tool        TEXT NOT NULL,
  summary     TEXT NOT NULL,             -- one line: file or command description
  detail      TEXT NOT NULL DEFAULT '',  -- the diff or the exact command
  cwd         TEXT NOT NULL DEFAULT '',
  hints       TEXT NOT NULL DEFAULT '[]', -- JSON string[]: closest allow rules
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','decided','expired')),
  decision    TEXT CHECK (decision IN ('allow','read_config','deny')),
  note        TEXT NOT NULL DEFAULT '',
  decided_by  TEXT,
  decided_at  TEXT,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX approvals_status ON approvals (status, created_at);
CREATE INDEX approvals_ticket ON approvals (ticket_id);

-- One review per PR, driven by the reviewer agent.
CREATE TABLE reviews (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT REFERENCES tickets(id) ON DELETE SET NULL,
  repo        TEXT NOT NULL,   -- owner/name
  pr          INTEGER NOT NULL,
  head_sha    TEXT NOT NULL DEFAULT '', -- the head that was reviewed
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','approving','approved')),
  salida_id   TEXT REFERENCES salidas(id) ON DELETE SET NULL, -- the approve write
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (repo, pr)
);

CREATE TABLE review_findings (
  id            TEXT PRIMARY KEY,
  review_id     TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  n             INTEGER NOT NULL,  -- stable number within the review
  label         TEXT NOT NULL CHECK (label IN ('blocker','nit','comment')),
  at            TEXT NOT NULL DEFAULT '',  -- "path:line"
  anchor        TEXT NOT NULL DEFAULT '',  -- code excerpt the finding points at
  summary       TEXT NOT NULL,
  explanation   TEXT NOT NULL DEFAULT '',
  state         TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','fixed','waived','dismissed')),
  sha           TEXT NOT NULL DEFAULT '',  -- head the finding was made on
  gh_comment_id TEXT,
  salida_id     TEXT REFERENCES salidas(id) ON DELETE SET NULL, -- the post write
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (review_id, n)
);

-- Per-source sweep state and health. The haiku sweeper (mesa-sweep skill) runs a ~60 s
-- two-stage tick per source: a cheap probe against the watermark, and a full triage only
-- when the probe finds something new, with adaptive backoff. Health feeds the rail notice.
CREATE TABLE source_state (
  source        TEXT PRIMARY KEY CHECK (source IN ('github','github_project','slack','basecamp','engram')),
  health        TEXT NOT NULL DEFAULT 'ok' CHECK (health IN ('ok','degraded','down')),
  note          TEXT NOT NULL DEFAULT '',
  watermark     TEXT,             -- opaque per source: Slack ts, Basecamp updated_at, GitHub Last-Modified
  last_checked_at TEXT,           -- last probe
  last_new_at   TEXT,             -- last probe that found something new
  backoff_until TEXT,             -- do not probe before this
  cadence_s     INTEGER NOT NULL DEFAULT 60, -- current probe interval
  updated_at    TEXT NOT NULL
);
