-- Calendario (t112): Andrés's Google Calendar, read-only, from the private iCal (ICS) address the server polls
-- (MESA_GCAL_ICS_URL, never stored here). One row per occurrence (a recurring meeting is expanded into the window
-- the poller keeps); every poll replaces the non-sample rows in one transaction. Creating an event is a salida
-- with the new source `calendar`.

CREATE TABLE calendar_events (
  id             TEXT PRIMARY KEY,
  uid            TEXT NOT NULL,                -- the ICS UID (shared by every occurrence of a series)
  occurrence_key TEXT NOT NULL,                -- the occurrence's ORIGINAL start (UTC ISO): stable when one is moved
  title          TEXT NOT NULL,
  starts_at      TEXT NOT NULL,                -- UTC ISO; all-day events: 00:00 UTC of the first day (all_day = 1)
  ends_at        TEXT NOT NULL,
  all_day        INTEGER NOT NULL DEFAULT 0,
  time_zone      TEXT,                         -- the event's own zone (IANA), when the feed names one
  location       TEXT,
  meet_url       TEXT,                         -- the Google Meet (or other conference) link, when there is one
  attendees      TEXT NOT NULL DEFAULT '[]',   -- JSON [{ email, name, response }]
  attendees_count INTEGER NOT NULL DEFAULT 0,
  organizer      TEXT,
  response       TEXT NOT NULL DEFAULT 'none' CHECK (response IN ('accepted','declined','tentative','needs_action','none')),
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','tentative')),
  recurring      INTEGER NOT NULL DEFAULT 0,
  is_sample      INTEGER NOT NULL DEFAULT 0,
  fetched_at     TEXT NOT NULL,
  UNIQUE (uid, occurrence_key)
);
CREATE INDEX calendar_events_starts ON calendar_events (starts_at);

-- The calendar's source health (rail notice, Calendario header) lives in source_state, and a calendar salida needs
-- the new source in its CHECK. SQLite cannot alter a CHECK in place and rebuilding salidas would cascade-delete
-- salida_turns and salida_versions (foreign keys are on), so the CHECK text is rewritten as in 0900_slack_drafts.sql.
PRAGMA writable_schema = ON;
UPDATE sqlite_schema
   SET sql = replace(sql, '''basecamp'',''engram'')', '''basecamp'',''engram'',''calendar'')')
 WHERE type = 'table' AND name = 'source_state';
UPDATE sqlite_schema
   SET sql = replace(sql, '''slack'',''basecamp'',''github''))', '''slack'',''basecamp'',''github'',''calendar''))')
 WHERE type = 'table' AND name = 'salidas';
PRAGMA writable_schema = RESET;
