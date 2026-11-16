-- t191: reminders. Two things are stored so they survive a restart, and a one-second sweep (repos().sweep) fires them.
--
-- 1. tickets.paused_until_at: an instant (ISO, UTC). A paused ticket with it comes back to Claude by itself when it is
--    reached (ticket.resumed by "date"). It is cleared whenever the ticket leaves paused, like the other pause fields.
-- 2. reminders: what a push is made of. kind 'note' is a standalone reminder (`mesa remind <when> <text> [--ref tN]`):
--    pending until due_at, then fired (a push, and it shows in Hoy until Andrés marks it done), or cancelled. kind 'resume'
--    is written by the sweep when a timed pause ends: already fired, it only carries the push "Vuelve · tN".
ALTER TABLE tickets ADD COLUMN paused_until_at TEXT;
CREATE INDEX tickets_paused_until_at ON tickets (paused_until_at) WHERE paused_until_at IS NOT NULL;

CREATE TABLE reminders (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('note', 'resume')),
  text       TEXT NOT NULL,
  due_at     TEXT NOT NULL,
  ticket_ref TEXT,
  state      TEXT NOT NULL CHECK (state IN ('pending', 'fired', 'done', 'cancelled')),
  created_at TEXT NOT NULL,
  fired_at   TEXT,
  closed_at  TEXT
);
CREATE INDEX reminders_due ON reminders (state, due_at);
