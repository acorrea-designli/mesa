-- Web Push subscriptions (t33): one row per phone (or browser) that asked for notifications with the app closed.
-- The endpoint is the push service URL of that device; it is unique, so a re-subscribe (the page re-syncs on every
-- load) is an upsert. A send answered 404/410 deletes the row. The notifier's seen keys and last scan time live in
-- the settings table (keys push.seen, push.last_scan).
CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_ok_at TEXT,
  last_error TEXT
);
