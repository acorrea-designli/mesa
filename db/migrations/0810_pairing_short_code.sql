-- Phone pairing, second way in (t28): besides the long code in the QR, /telefono shows a short code the person types
-- inside an installed app (an iOS home-screen app may not share Safari's cookies). Same row, same 10 minutes, same
-- single use; only its SHA-256 is stored. pair_failures counts wrong tries (max 5 per 10 minutes, then 429).
ALTER TABLE phone_pairings ADD COLUMN short_hash TEXT;

CREATE TABLE pair_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL
);
