-- t143 PR5: "Permitir esta vez". Allowing a "Bloqueado por el modo automático" card for a call that no settings rule can
-- cover (a command, an MCP tool) stores ONE grant, derived by the server from the card's stored call: the tool, a hash of
-- the call's identity (src/lib/domain/approval-grant.ts), the caller (agent name, or "lead") and its session. The
-- PreToolUse hook consumes it atomically for the retried call (used_at); it never matches twice and it expires.
-- `session_id` on the card is the session that was denied (from the hook input), so another session never inherits it.
ALTER TABLE approvals ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
CREATE TABLE approval_grants (
  id          TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  tool        TEXT NOT NULL,
  input_hash  TEXT NOT NULL,
  caller      TEXT NOT NULL,
  session_id  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX approval_grants_lookup ON approval_grants(tool, input_hash, caller, session_id) WHERE used_at IS NULL;
