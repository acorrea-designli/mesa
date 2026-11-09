-- Phone pairing (t28): the QR on /telefono carries a one-time code. Only its SHA-256 is stored, so a copy of the
-- database cannot be turned into a login. A code lives 10 minutes and works once (used_at is set atomically).
CREATE TABLE phone_pairings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash  TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
