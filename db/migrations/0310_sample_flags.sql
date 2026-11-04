-- Sample flags for tables whose rows do not hang off a sample ticket or salida through
-- ON DELETE CASCADE, so `pnpm seed --reset` can delete samples without touching real rows.
-- (items, tasks, tickets and salidas already have is_sample; ticket_messages, ticket_refs,
-- planned_actions, attachments, ticket_briefs, ticket_handoffs, ticket_team, salida_versions,
-- salida_turns and review_findings cascade from their parent.)

-- ticket_id is ON DELETE SET NULL: a sample approval would survive its ticket and show on Hoy.
ALTER TABLE approvals ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;

-- ticket_id and salida_id are ON DELETE SET NULL; findings cascade from the review.
ALTER TABLE reviews ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;

-- No foreign keys.
ALTER TABLE learned_chips ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engram_links ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
