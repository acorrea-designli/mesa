-- t196: the Basecamp uploads of a salida. After each create_attachment the lead records the attachable_sgid it got
-- back for the file with this SHA-256; hook G5 passes the create_message / create_comment that embeds those sgids
-- (and only those) next to the approved text. One row per file of the salida (a retried upload replaces its row).
CREATE TABLE salida_uploads (
  salida_id TEXT NOT NULL REFERENCES salidas(id) ON DELETE CASCADE,
  file_index INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  sgid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (salida_id, file_index)
);
