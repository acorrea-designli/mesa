// Calendario (t112): pure helpers over the stored events. The next meeting, who needs a reminder, a day's agenda,
// the free slots Claude proposes from and the labels the screens share. Nothing here reads a clock or the database.
// Everything is drawn in Bogota (UTC-5 all year), like /semana.
import type { CalendarEvent } from "./types";
import { addDays, localDay, mondayOf, WEEK_TZ } from "./week";

export const REMIND_MINUTES = 10;

/** Opening line of every meeting-request ticket (POST /api/calendar/requests); the lead's mesa-ticket skill keys on it. */
export const MEETING_REQUEST_MARK = "Pedido de reunión (Calendario)";
const MIN = 60_000;

/** The repeat choices of "Pedir reunión" (t128), in the order of the picker, and the text the request ticket carries. */
export const REPEAT_CHOICES = ["weekly", "biweekly", "monthly"] as const;
export type RepeatChoice = (typeof REPEAT_CHOICES)[number];
export const REPEAT_LABEL: Record<RepeatChoice, string> = { weekly: "cada semana", biweekly: "cada 2 semanas", monthly: "cada mes" };

/** A meeting is what reminds and what the strip shows: timed, and not declined by Andrés. */
export const isMeeting = (e: CalendarEvent): boolean => !e.allDay && e.response !== "declined";

const byStart = (a: CalendarEvent, b: CalendarEvent) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title);

/** The meeting in progress, else the next one to start (the "Próxima reunión" strip). */
export function nextMeeting(events: readonly CalendarEvent[], now: Date): CalendarEvent | null {
  const t = now.getTime();
  const open = events.filter((e) => isMeeting(e) && Date.parse(e.endsAt) > t).sort(byStart);
  const current = open.find((e) => Date.parse(e.startsAt) <= t);
  return current ?? open[0] ?? null;
}

/** The reminder key: once per event start (a moved start is a new key and notifies again). */
export const meetingKey = (e: Pick<CalendarEvent, "id" | "startsAt">): string => `meeting:${e.id}:${e.startsAt}`;

/**
 * Meetings whose reminder is due: it starts within REMIND_MINUTES and has not started. A scan that runs late (the
 * server was busy, the tab was asleep) still reminds until the start; after it, the meeting is the strip's, not an alert.
 */
export function remindersDue(events: readonly CalendarEvent[], now: Date): CalendarEvent[] {
  const t = now.getTime();
  return events
    .filter((e) => {
      if (!isMeeting(e)) return false;
      const start = Date.parse(e.startsAt);
      return start > t && start - REMIND_MINUTES * MIN <= t;
    })
    .sort(byStart);
}

// ---------- labels ----------

const CLOCK = new Intl.DateTimeFormat("es-CO", { timeZone: WEEK_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "15:00" in Bogota. */
export const clockOf = (iso: string | Date): string => CLOCK.format(typeof iso === "string" ? new Date(iso) : iso);

/** "15:00–15:30", or "Todo el día". */
export const rangeLabel = (e: Pick<CalendarEvent, "startsAt" | "endsAt" | "allDay">): string => (e.allDay ? "Todo el día" : `${clockOf(e.startsAt)}–${clockOf(e.endsAt)}`);

/** "en 18 min", "en 1 h 05 min", "ahora" (started) or "termina 15:30" for the meeting in progress. */
export function whenLabel(e: Pick<CalendarEvent, "startsAt" | "endsAt">, now: Date): string {
  const t = now.getTime();
  const start = Date.parse(e.startsAt);
  if (start <= t) return `termina ${clockOf(e.endsAt)}`;
  const m = Math.max(1, Math.ceil((start - t) / MIN));
  if (m < 60) return `en ${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `en ${h} h ${String(r).padStart(2, "0")} min` : `en ${h} h`;
}

const DAY_LABEL = new Intl.DateTimeFormat("es-CO", { timeZone: WEEK_TZ, weekday: "long", day: "numeric", month: "short" });
/** "jueves 12 nov" for a YYYY-MM-DD. */
export const dayLabel = (ymd: string): string => DAY_LABEL.format(new Date(`${ymd}T12:00:00-05:00`)).replace(",", "").replace(" de ", " ").replace(/\./g, "");
const SHORT = new Intl.DateTimeFormat("es-CO", { timeZone: WEEK_TZ, weekday: "short", day: "numeric" });
/** "Mié 11" for a YYYY-MM-DD (the week band). */
export function shortDay(ymd: string): string {
  const s = SHORT.format(new Date(`${ymd}T12:00:00-05:00`)).replace(/\./g, "").replace(",", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- days and weeks ----------

export const bogotaStart = (ymd: string): number => Date.parse(`${ymd}T00:00:00-05:00`);

/** Monday to Friday of the week `ymd` falls in; Saturday and Sunday are added when they hold a meeting. */
export function weekDays(ymd: string, events: readonly CalendarEvent[] = []): string[] {
  const mon = mondayOf(ymd);
  const days = [0, 1, 2, 3, 4].map((n) => addDays(mon, n));
  for (const n of [5, 6]) {
    const d = addDays(mon, n);
    if (events.some((e) => !e.allDay && e.response !== "declined" && localDay(new Date(e.startsAt)) === d)) days.push(d);
  }
  return days;
}

/** Events that touch one Bogota day, all-day first, then by start. */
export function eventsOn(events: readonly CalendarEvent[], ymd: string): CalendarEvent[] {
  const from = bogotaStart(ymd);
  const to = bogotaStart(addDays(ymd, 1));
  return events
    .filter((e) => Date.parse(e.startsAt) < to && (Date.parse(e.endsAt) > from || Date.parse(e.startsAt) >= from))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || byStart(a, b));
}

/** The meetings left on a day (not declined, not all-day, not over). */
export const meetingsLeft = (events: readonly CalendarEvent[], now: Date): number => eventsOn(events, localDay(now)).filter((e) => isMeeting(e) && Date.parse(e.endsAt) > now.getTime()).length;

// ---------- free slots ----------

export interface Slot {
  start: string;
  end: string;
}

export interface FreeOptions {
  /** Working hours in Bogota, "HH:MM". */
  open?: string;
  close?: string;
  /** The shortest gap worth proposing. */
  minMinutes?: number;
  /** Do not propose before this instant (today: now). */
  notBefore?: Date;
}

const hm = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/**
 * The free gaps of one Bogota day inside working hours, from the stored events. Declined meetings and all-day events
 * do not block; tentative ones do. A gap shorter than `minMinutes` is dropped.
 */
export function freeSlots(events: readonly CalendarEvent[], ymd: string, o: FreeOptions = {}): Slot[] {
  const day0 = bogotaStart(ymd);
  const open = day0 + hm(o.open ?? "08:00") * MIN;
  const close = day0 + hm(o.close ?? "19:00") * MIN;
  const min = (o.minMinutes ?? 30) * MIN;
  let from = Math.max(open, o.notBefore ? o.notBefore.getTime() : 0);
  const busy = events
    .filter(isMeeting)
    .map((e) => [Date.parse(e.startsAt), Date.parse(e.endsAt)] as const)
    .filter(([s, e]) => e > from && s < close)
    .sort((a, b) => a[0] - b[0]);
  const out: Slot[] = [];
  for (const [s, e] of busy) {
    if (s - from >= min) out.push({ start: new Date(from).toISOString(), end: new Date(Math.min(s, close)).toISOString() });
    from = Math.max(from, e);
  }
  if (close - from >= min) out.push({ start: new Date(from).toISOString(), end: new Date(close).toISOString() });
  return out;
}

/** The meetings that overlap [start, end): what a proposed event would collide with. */
export function conflictsWith(events: readonly CalendarEvent[], start: Date, end: Date): CalendarEvent[] {
  return events.filter((e) => isMeeting(e) && Date.parse(e.startsAt) < end.getTime() && Date.parse(e.endsAt) > start.getTime()).sort(byStart);
}

/** People Andrés has met, from the stored events: address to name and how many shared meetings (to find an invitee's email). */
export function knownPeople(events: readonly CalendarEvent[], ownerEmail?: string | null): { email: string; name: string | null; meetings: number }[] {
  const owner = ownerEmail?.toLowerCase() ?? null;
  const by = new Map<string, { email: string; name: string | null; meetings: number }>();
  for (const e of events)
    for (const a of e.attendees) {
      if (!a.email || a.email === owner) continue;
      const cur = by.get(a.email) ?? { email: a.email, name: null, meetings: 0 };
      cur.meetings++;
      cur.name ??= a.name;
      by.set(a.email, cur);
    }
  return [...by.values()].sort((a, b) => b.meetings - a.meetings || a.email.localeCompare(b.email));
}

// ---------- the stored window (t127) ----------

/** What the poller keeps: 13 weeks back and 26 ahead of today (Bogota). The screen reads these to say what lies outside. */
export const STORED_BACK_DAYS = 13 * 7;
export const STORED_AHEAD_DAYS = 26 * 7;

/** The Bogota days the poller keeps for a given today: `fromDay` inclusive, `toDay` exclusive. */
export const storedWindow = (today: string): { fromDay: string; toDay: string } => ({ fromDay: addDays(today, -STORED_BACK_DAYS), toDay: addDays(today, STORED_AHEAD_DAYS) });

export type Coverage = "in" | "partial" | "out";

/** Is the Bogota day range [fromDay, toDay) inside what Mesa stores? `out` means none of it is, so an empty list there says nothing. */
export function coverageOf(fromDay: string, toDay: string, today: string): Coverage {
  const w = storedWindow(today);
  if (toDay <= w.fromDay || fromDay >= w.toDay) return "out";
  return fromDay >= w.fromDay && toDay <= w.toDay ? "in" : "partial";
}
