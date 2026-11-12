// Links into Google Calendar (t127), pure. Mesa never writes to Google: these are plain `https://` links the screen
// opens in a new tab. The event link is built from the iCal UID plus the occurrence's original start, because the
// private feed carries no per-event URL. The `eid` format is Google's own (the one in an event's htmlLink):
// base64 without padding of "<event id> <calendar id>" with ONE space. When the link cannot be built (a UID that is
// not Google's, or no calendar id) the event's day opens instead, so the link is always useful.
import type { CalendarEvent } from "./types";
import { localDay } from "./week";

const GOOGLE = "https://calendar.google.com/calendar";
const EVENT_BASE = "https://www.google.com/calendar/event";

/** "2026-11-12" -> "2026/11/12" with no zero padding, the way Google's day and week URLs read. */
const path = (ymd: string): string => {
  const [y, m, d] = ymd.split("-");
  return `${Number(y)}/${Number(m)}/${Number(d)}`;
};

/** The day view of a Bogota day: the fallback of an event link. */
export const googleDayUrl = (ymd: string): string => `${GOOGLE}/r/day/${path(ymd)}`;
/** The week view that holds a day (pass the Monday, or any day of the week). */
export const googleWeekUrl = (ymd: string): string => `${GOOGLE}/r/week/${path(ymd)}`;

const UID = /^([A-Za-z0-9_-]+)@google\.com$/i;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** The instance suffix: the occurrence's ORIGINAL start (UTC `YYYYMMDDTHHMMSSZ`), or `YYYYMMDD` for an all-day event. */
function instanceSuffix(occurrenceKey: string, allDay: boolean): string | null {
  const ms = Date.parse(occurrenceKey);
  if (Number.isNaN(ms)) return null;
  if (allDay) return localDay(new Date(ms)).replaceAll("-", "");
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/** The `eid` of an event, or null when the UID is not Google's, the calendar id is missing or the key is unreadable. */
export function googleEid(e: Pick<CalendarEvent, "uid" | "occurrenceKey" | "allDay" | "recurring">, calendarId: string | null | undefined): string | null {
  const id = UID.exec(e.uid.trim())?.[1];
  const cal = calendarId?.trim();
  if (!id || !cal || !EMAIL.test(cal)) return null;
  let eventId = id;
  if (e.recurring) {
    const suffix = instanceSuffix(e.occurrenceKey, e.allDay);
    if (!suffix) return null;
    eventId = `${id}_${suffix}`;
  }
  const raw = `${eventId} ${cal}`;
  if (!/^[\x20-\x7e]+$/.test(raw)) return null;
  return btoa(raw).replace(/=+$/, "");
}

/** Where "Abrir en Google" goes: that event (that occurrence of a series), else the event's day in Google Calendar. */
export function googleEventUrl(e: Pick<CalendarEvent, "uid" | "occurrenceKey" | "allDay" | "recurring" | "startsAt">, calendarId: string | null | undefined): string {
  const eid = googleEid(e, calendarId);
  if (eid) return `${EVENT_BASE}?eid=${encodeURIComponent(eid)}`;
  return googleDayUrl(localDay(new Date(e.startsAt)));
}
