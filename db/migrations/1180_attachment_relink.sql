-- t205: one PDF document per ticket and filename. Revisions that were attached without --version-of are separate root
-- attachments (version 1, version_of NULL) with the same filename; Documentos showed one row per revision. Relink them
-- into one chain per (ticket, filename): the earliest root by created_at stays the root (version 1), the others become
-- versions 2..n in created_at order (version_of = that root). A root that already has versions brings them along, in
-- their own order. Attachment ids never change, so marks, reviews and approvals stay on the revision they were made on.
-- Idempotent: after it runs there is one root per (ticket, filename), so a second run matches nothing.
CREATE TEMP TABLE _attachment_relink AS
WITH roots AS (
  SELECT rowid AS rid, id, ticket_id, filename, created_at,
         COUNT(*) OVER (PARTITION BY ticket_id, filename) AS n,
         FIRST_VALUE(id) OVER (PARTITION BY ticket_id, filename ORDER BY created_at, rowid) AS root_id
  FROM attachments
  WHERE mime = 'application/pdf' AND version_of IS NULL
)
SELECT a.id AS id, r.root_id AS root_id,
       ROW_NUMBER() OVER (
         PARTITION BY r.ticket_id, r.filename
         ORDER BY r.created_at, r.rid, a.version, a.created_at, a.rowid
       ) AS rn
FROM attachments a
JOIN roots r ON r.n > 1 AND (a.id = r.id OR a.version_of = r.id);

UPDATE attachments
SET version_of = CASE WHEN (SELECT rn FROM _attachment_relink m WHERE m.id = attachments.id) = 1 THEN NULL
                      ELSE (SELECT root_id FROM _attachment_relink m WHERE m.id = attachments.id) END,
    version = (SELECT rn FROM _attachment_relink m WHERE m.id = attachments.id)
WHERE id IN (SELECT id FROM _attachment_relink);

DROP TABLE _attachment_relink;
