-- A plain question from Claude (`mesa ticket reply --ask`, or the opening message of a Claude-asks ticket without options) is
-- not a card, so nothing stored said it was waiting for an answer. `asks` marks the message; it stays open until a later
-- message of Andrés (src/lib/repo/tickets.ts setActionState: skipping the last plan step must not take a ticket out of
-- Te espera while he still owes this answer). Existing messages are not asks.
ALTER TABLE ticket_messages ADD COLUMN asks INTEGER NOT NULL DEFAULT 0;
