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
CREATE TABLE handoffs (
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
CREATE INDEX handoffs_ticket ON handoffs (ticket_id, created_at);
CREATE INDEX handoffs_agent ON handoffs (agent, created_at);

-- Agents attached to a ticket. Names are <role>-<ticketRef>[-k] and are never reused.
CREATE TABLE team_agents (
  name        TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  owner       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','retired')),
  spawned_at  TEXT NOT NULL,
  retired_at  TEXT
);
CREATE INDEX team_agents_ticket ON team_agents (ticket_id, status);

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

-- Health per source, reported by sessions and the server (GitHub).
CREATE TABLE source_health (
  source      TEXT PRIMARY KEY CHECK (source IN ('github','github_project','slack','basecamp','engram')),
  state       TEXT NOT NULL CHECK (state IN ('ok','down','limited')),
  note        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);
