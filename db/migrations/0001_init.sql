-- Mesa initial schema. Timestamps are ISO-8601 UTC strings. JSON columns hold TEXT.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Kanban cards on Tablero, mirrored to the private GitHub Project.
CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  excerpt        TEXT NOT NULL DEFAULT '',
  project        TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL CHECK (source IN ('github','slack','basecamp','claude')),
  station        TEXT NOT NULL DEFAULT 'inbox' CHECK (station IN ('inbox','todo','doing','waiting','done')),
  wait_on        TEXT NOT NULL DEFAULT 'you',
  position       REAL NOT NULL DEFAULT 0,
  gh_item_id     TEXT,
  gh_content_url TEXT,
  sync_state     TEXT NOT NULL DEFAULT 'pending' CHECK (sync_state IN ('synced','pending','error','local')),
  sync_error     TEXT,
  synced_at      TEXT,
  is_sample      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX tasks_station ON tasks (station, position);

-- Work that waits on Andrés, ingested from a source (PR review request, Basecamp
-- request, Slack thread, Claude question). Shown on Hoy.
CREATE TABLE items (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL CHECK (source IN ('github','slack','basecamp','claude')),
  external_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  excerpt      TEXT NOT NULL DEFAULT '',
  project      TEXT NOT NULL DEFAULT '',
  url          TEXT,
  need         TEXT NOT NULL DEFAULT 'reply',
  station      TEXT NOT NULL DEFAULT 'inbox' CHECK (station IN ('inbox','todo','doing','waiting','done')),
  wait_on      TEXT NOT NULL DEFAULT 'you',
  tag          TEXT,
  task_id      TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  meta         TEXT NOT NULL DEFAULT '{}',
  is_sample    INTEGER NOT NULL DEFAULT 0,
  received_at  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX items_station ON items (station, received_at);
CREATE INDEX items_task ON items (task_id);

-- Claude Code sessions (the workers). id is chosen by the session (MESA_SESSION).
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL DEFAULT '',
  cwd           TEXT NOT NULL DEFAULT '',
  project       TEXT NOT NULL DEFAULT '',
  cursor        INTEGER NOT NULL DEFAULT 0,
  waiting_since TEXT,
  last_seen_at  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Tickets: Claude <-> Andrés in one stream. direction is a property, not a board.
CREATE TABLE tickets (
  id            TEXT PRIMARY KEY,
  ref           TEXT NOT NULL UNIQUE,
  direction     TEXT NOT NULL CHECK (direction IN ('claude_asks','andres_asks')),
  title         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('waiting_andres','waiting_claude','working','closed')),
  project       TEXT NOT NULL DEFAULT '',
  owner_session TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  item_id       TEXT REFERENCES items(id) ON DELETE SET NULL,
  is_sample     INTEGER NOT NULL DEFAULT 0,
  woke_at       TEXT,
  closed_at     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX tickets_status ON tickets (status, updated_at);

CREATE TABLE ticket_messages (
  id             TEXT PRIMARY KEY,
  ticket_id      TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author         TEXT NOT NULL CHECK (author IN ('andres','claude')),
  body           TEXT NOT NULL DEFAULT '',
  options        TEXT,  -- JSON [{key,label,detail}] when Claude asks for a choice
  recommended    TEXT,  -- option key Claude recommends
  recommendation TEXT,  -- one line: why Claude recommends it
  chosen         TEXT,  -- option key Andrés picked
  created_at     TEXT NOT NULL
);
CREATE INDEX ticket_messages_ticket ON ticket_messages (ticket_id, created_at);

CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message_id  TEXT REFERENCES ticket_messages(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  path        TEXT NOT NULL,  -- relative to data/uploads
  created_at  TEXT NOT NULL
);
CREATE INDEX attachments_ticket ON attachments (ticket_id);

-- @ references from a ticket to another ticket, an item, or a plain URL.
CREATE TABLE ticket_refs (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message_id  TEXT REFERENCES ticket_messages(id) ON DELETE CASCADE,
  ref_type    TEXT NOT NULL CHECK (ref_type IN ('ticket','item','url')),
  target      TEXT NOT NULL,  -- ticket id, item id or URL
  label       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX ticket_refs_ticket ON ticket_refs (ticket_id);

-- "Claude va a hacer": one row per planned action on a ticket.
CREATE TABLE planned_actions (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  kind        TEXT NOT NULL,  -- cancel_salida | move_card | create_task | review_pr | investigate | send_message | other
  source      TEXT NOT NULL CHECK (source IN ('github','slack','basecamp','claude')),
  label       TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('direct','needs_ok')),
  state       TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','approved','rejected','running','done','failed')),
  target      TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX planned_actions_ticket ON planned_actions (ticket_id, seq);

-- Outgoing messages that need Andrés's approval.
CREATE TABLE salidas (
  id                  TEXT PRIMARY KEY,
  status              TEXT NOT NULL CHECK (status IN ('draft','pending','sending','sent','failed','denied','expired','scheduled','deleted')),
  source              TEXT NOT NULL CHECK (source IN ('slack','basecamp')),
  destination         TEXT NOT NULL,  -- JSON Destination
  title               TEXT NOT NULL DEFAULT '',
  context             TEXT NOT NULL DEFAULT '',
  ticket_id           TEXT REFERENCES tickets(id) ON DELETE SET NULL,
  links               TEXT NOT NULL DEFAULT '[]',  -- JSON [{source,label,url}]
  owner_session       TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  current_version     INTEGER NOT NULL DEFAULT 0,
  approved_version    INTEGER,
  undo_until          TEXT,
  released_at         TEXT,
  send_at             TEXT,
  expires_at          TEXT,
  sent_at             TEXT,
  permalink           TEXT,
  error               TEXT,
  delete_requested_at TEXT,
  deleted_at          TEXT,
  is_sample           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX salidas_status ON salidas (status, updated_at);

-- Refine chat ("Afinar con Claude"). An Andrés turn may carry semáforo marks.
CREATE TABLE salida_turns (
  id          TEXT PRIMARY KEY,
  salida_id   TEXT NOT NULL REFERENCES salidas(id) ON DELETE CASCADE,
  author      TEXT NOT NULL CHECK (author IN ('andres','claude')),
  body        TEXT NOT NULL DEFAULT '',
  marks       TEXT NOT NULL DEFAULT '[]',  -- JSON [{start,end,kind,text}]
  on_version  INTEGER NOT NULL,
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','cancelled')),
  chip_label  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX salida_turns_salida ON salida_turns (salida_id, created_at);

-- Immutable versions of a salida's text. n starts at 1.
CREATE TABLE salida_versions (
  id          TEXT PRIMARY KEY,
  salida_id   TEXT NOT NULL REFERENCES salidas(id) ON DELETE CASCADE,
  n           INTEGER NOT NULL,
  body        TEXT NOT NULL,
  author      TEXT NOT NULL CHECK (author IN ('claude','andres')),
  turn_id     TEXT REFERENCES salida_turns(id) ON DELETE SET NULL,
  starred     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE (salida_id, n)
);

-- Quick chips learned from Andrés's own refine requests, grouped by meaning.
CREATE TABLE learned_chips (
  label        TEXT PRIMARY KEY,
  phrasings    TEXT NOT NULL DEFAULT '[]',  -- JSON string[], most recent first, capped
  uses         INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL
);

-- Wake events for Claude sessions. id is the long-poll cursor.
CREATE TABLE wake_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT,  -- target session; NULL means any session
  kind        TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX wake_events_session ON wake_events (session_id, id);

-- Pointers from Mesa entities to engram observations (engram is the primary memory).
CREATE TABLE engram_links (
  id             TEXT PRIMARY KEY,
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('ticket','salida','task')),
  entity_id      TEXT NOT NULL,
  project        TEXT NOT NULL,
  topic_key      TEXT,
  observation_id TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX engram_links_entity ON engram_links (entity_type, entity_id);
