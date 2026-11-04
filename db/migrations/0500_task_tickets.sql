-- A task handed to Claude ("Dárselo a Claude", or created without "Solo anotar") gets a linked
-- ticket of direction andres_asks. The link is kept both ways so the card can show its owner
-- agent and the ticket can name its card. Deleting either side only clears the link.
ALTER TABLE tasks ADD COLUMN ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX tasks_ticket ON tasks (ticket_id);
CREATE INDEX tickets_task ON tickets (task_id);
