-- t135: "Terminé" on a PDF in the review view. reviewed_at is when Andrés marked the PDF as finished; NULL means
-- pendiente. Only he sets it (and can undo it); the Documentos list reads this flag, never the count of marks.
ALTER TABLE attachments ADD COLUMN reviewed_at TEXT;
