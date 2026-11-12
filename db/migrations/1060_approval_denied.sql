-- t128 part H: "Bloqueado por el modo automático". The PermissionDenied hook (scripts/hooks/mesa-denied.mjs) files a card
-- for a call that auto mode already denied. It reuses the approvals table: `kind` tells the two apart, the denied call's
-- raw tool_input and the denial reason are kept so the server can derive the allow rule itself (never from the client),
-- and `rule` is the rule proposed on the card (and, once Andrés allows it, the rule written to settings.local.json).
-- Existing rows are ordinary permission cards.
ALTER TABLE approvals ADD COLUMN kind TEXT NOT NULL DEFAULT 'permission';
ALTER TABLE approvals ADD COLUMN reason TEXT NOT NULL DEFAULT '';
ALTER TABLE approvals ADD COLUMN denied_input TEXT NOT NULL DEFAULT '';
ALTER TABLE approvals ADD COLUMN rule TEXT NOT NULL DEFAULT '';
