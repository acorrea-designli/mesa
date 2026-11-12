-- Checklists (t124). A Claude message can carry a list of 1-30 manual steps for Andrés (configure a calendar, paste a
-- URL, authorize a connector): each step has its text, an optional Markdown detail and a checkbox. Anyone can set a
-- step either way, any number of times: Andrés from the board or the phone, Claude from the CLI when it verified the
-- step itself (`done_by` says who, `note` is Claude's one-line proof). Nothing else changes a step: not a later
-- message, a reply, or closing the ticket.
CREATE TABLE ticket_steps (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES ticket_messages(id) ON DELETE CASCADE,
  n          INTEGER NOT NULL,                -- step in its checklist, from 1
  text       TEXT NOT NULL,
  detail     TEXT,                            -- optional Markdown
  state      TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','done')),
  done_by    TEXT CHECK (done_by IN ('andres','claude')),  -- NULL while open
  done_at    TEXT,
  note       TEXT,                            -- Claude's verification line, NULL when Andrés ticked it
  created_at TEXT NOT NULL,
  UNIQUE (message_id, n),
  CHECK ((state = 'open' AND done_by IS NULL AND done_at IS NULL) OR (state = 'done' AND done_by IS NOT NULL AND done_at IS NOT NULL))
);
CREATE INDEX ticket_steps_ticket ON ticket_steps (ticket_id, state);
