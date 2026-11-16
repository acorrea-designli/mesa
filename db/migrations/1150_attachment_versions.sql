-- t190: one document with versions. Each version is its own attachment row (own file, own id, own marks); a
-- document is the root attachment (version_of NULL, version 1) plus the rows that point at it with version 2, 3...
-- A version is never re-pointed at another root: `mesa ticket attach --version-of <any version id>` resolves to the root.
ALTER TABLE attachments ADD COLUMN version_of TEXT REFERENCES attachments(id) ON DELETE CASCADE;
ALTER TABLE attachments ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX idx_attachments_version_of ON attachments(version_of);
-- "Aprobar" in the review view: Andrés approves THAT version of a document (own flag per version, like reviewed_at).
-- NULL = not approved. Approving wakes the owner (ticket.document_approved); taking it back wakes nobody.
ALTER TABLE attachments ADD COLUMN approved_at TEXT;
