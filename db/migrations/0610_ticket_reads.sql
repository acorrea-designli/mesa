-- Read state of the Tickets list: when Andrés last opened a ticket. A ticket is "new" while it
-- has a message not written by him that is newer than this (src/lib/repo/tickets.ts unreadIds).
-- One row per ticket, absent until it is first opened. Tickets that exist when this migration
-- runs start as seen, so the flag only marks what arrives afterwards.
CREATE TABLE ticket_reads (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  seen_at   TEXT NOT NULL
);
INSERT INTO ticket_reads (ticket_id, seen_at)
  SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tickets;
