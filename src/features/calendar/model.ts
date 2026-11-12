// Calendario view model (pure): the agenda rows, the week stations, the health pill and the strip's words.
// Times are Bogota; everything is derived from the stored events and an explicit `now`.
import { clockOf, coverageOf, eventsOn, isMeeting, nextMeeting, rangeLabel, REMIND_MINUTES, shortDay, STORED_AHEAD_DAYS, STORED_BACK_DAYS, weekDays, whenLabel } from "@/lib/domain/calendar";
import { googleDayUrl, googleWeekUrl } from "@/lib/domain/google-calendar";
import type { CalendarEvent, CalendarPayload } from "@/lib/domain/types";
import { addDays, localDay, mondayOf } from "@/lib/domain/week";

export type RowState = "past" | "now" | "next" | "ahead" | "declined" | "allday";

export interface AgendaRow {
  event: CalendarEvent;
  state: RowState;
  /** "15:00–15:30" or "Todo el día". */
  time: string;
  /** The line under the title. */
  sub: string;
  /** The count column: attendees, or "" when the feed lists nobody. */
  people: string;
  /** Unirse is offered: there is a Meet link and the meeting is not over or declined. */
  canJoin: boolean;
  /** "Abrir en Google": the event's own link, else the day it is on. Always set. */
  openUrl: string;
}

export const calendarHref = (day?: string | null, view?: "hoy" | "semana"): string => {
  const q = [day ? `dia=${day}` : "", view === "semana" ? "vista=semana" : ""].filter(Boolean).join("&");
  return q ? `/calendario?${q}` : "/calendario";
};

const remindAt = (e: CalendarEvent) => clockOf(new Date(Date.parse(e.startsAt) - REMIND_MINUTES * 60_000));

/** The rows of one Bogota day. All-day events first, then by start; the next meeting is marked. */
export function agendaRows(events: readonly CalendarEvent[], ymd: string, now: Date): AgendaRow[] {
  const t = now.getTime();
  const next = nextMeeting(events, now);
  return eventsOn(events, ymd).map((e) => {
    const over = Date.parse(e.endsAt) <= t;
    const started = Date.parse(e.startsAt) <= t;
    const state: RowState = e.allDay ? "allday" : e.response === "declined" ? "declined" : over ? "past" : started ? "now" : next?.id === e.id ? "next" : "ahead";
    let sub: string;
    if (e.allDay) sub = "Sin aviso · los eventos de todo el día no avisan";
    else if (e.response === "declined") sub = "Rechazada por ti · sin aviso";
    else {
      const where = e.meetUrl ? "Google Meet" : e.location ? e.location : "Sin Meet";
      sub = state === "next" ? `${where} · ${whenLabel(e, now)} · aviso a las ${remindAt(e)}` : state === "now" ? `${where} · ${whenLabel(e, now)}` : state === "past" ? `${where} · terminó` : where;
    }
    return {
      event: e,
      state,
      time: rangeLabel(e),
      sub,
      people: e.attendeesCount > 0 ? String(e.attendeesCount) : "",
      canJoin: Boolean(e.meetUrl) && (state === "next" || state === "now" || state === "ahead"),
      openUrl: e.googleUrl ?? googleDayUrl(localDay(new Date(e.startsAt))),
    };
  });
}

export interface Station {
  ymd: string;
  /** "Mié 11". */
  name: string;
  /** Meetings that day (not declined, not all-day). */
  count: number;
  /** "hoy · 3 faltan" under the selected today, "reuniones" otherwise. */
  note: string;
  selected: boolean;
  today: boolean;
  /** The day is over: drawn like the part of the Hoy band that is behind you. */
  past: boolean;
}

/** The week band: Monday to Friday of the selected day's week (the weekend only when it holds a meeting). */
export function stations(events: readonly CalendarEvent[], selected: string, now: Date): Station[] {
  const today = localDay(now);
  return weekDays(selected, events).map((ymd) => {
    const day = eventsOn(events, ymd).filter((e) => isMeeting(e));
    const left = ymd === today ? day.filter((e) => Date.parse(e.endsAt) > now.getTime()).length : day.length;
    return {
      ymd,
      name: shortDay(ymd),
      count: day.length,
      note: ymd === today ? (left ? `hoy · ${left} ${left === 1 ? "falta" : "faltan"}` : "hoy") : day.length === 1 ? "reunión" : "reuniones",
      selected: ymd === selected,
      today: ymd === today,
      past: ymd < today,
    };
  });
}

export interface Pill {
  text: string;
  /** Dashed: not connected, read failing or sample data. */
  off: boolean;
}

/** The header's source-health pill. */
export function healthPill(d: Pick<CalendarPayload, "configured" | "sandbox" | "health" | "lastRefresh" | "note" | "events">, now: Date): Pill {
  const hasSamples = d.events.some((e) => e.isSample);
  if (d.sandbox) return { text: "Sandbox · sin lectura de Google", off: true };
  if (!d.configured) return { text: hasSamples ? "Datos de muestra" : "Sin conectar", off: true };
  if (d.health === "down" || d.health === "degraded") return { text: d.lastRefresh ? `Última lectura ${clockOf(d.lastRefresh)}` : "Sin lectura todavía", off: true };
  if (!d.lastRefresh) return { text: "Google Calendar · leyendo…", off: false };
  const min = Math.floor((now.getTime() - Date.parse(d.lastRefresh)) / 60_000);
  return { text: `Google Calendar · ${min < 1 ? "leído ahora" : `leído hace ${min} min`}`, off: false };
}

export type StripMode = "next" | "soon" | "now" | "none";

export interface StripModel {
  mode: StripMode;
  event: CalendarEvent | null;
  /** "en 18 min", "termina 15:30". */
  when: string;
  time: string;
}

/** The "Próxima reunión" strip: the meeting in progress, the next one (ink border within the reminder window) or nothing left. */
export function stripModel(next: CalendarEvent | null, now: Date): StripModel {
  if (!next) return { mode: "none", event: null, when: "", time: "" };
  const t = now.getTime();
  const start = Date.parse(next.startsAt);
  const mode: StripMode = start <= t ? "now" : start - t <= REMIND_MINUTES * 60_000 ? "soon" : "next";
  // Nothing left today: the strip says which day the next one is on ("mañana", "jue 12").
  const day = localDay(new Date(next.startsAt));
  const today = localDay(now);
  const when = day === today ? whenLabel(next, now) : day === addDays(today, 1) ? "mañana" : shortDay(day).toLowerCase();
  return { mode, event: next, when, time: rangeLabel(next) };
}


// ---------- week navigation (t127) ----------

const MONTH = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const part = (ymd: string) => ({ y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)) - 1, d: Number(ymd.slice(8, 10)) });

/** "10–16 nov", "28 sep–4 oct"; a week that is not in the current year (or spans two) carries the year: "28 dic 2026–3 ene 2027". */
export function weekLabel(monday: string, today: string): string {
  const a = part(monday);
  const b = part(addDays(monday, 6));
  const thisYear = part(today).y;
  if (a.y !== b.y) return `${a.d} ${MONTH[a.m]} ${a.y}–${b.d} ${MONTH[b.m]} ${b.y}`;
  const yr = a.y === thisYear ? "" : ` ${a.y}`;
  if (a.m === b.m) return `${a.d}–${b.d} ${MONTH[a.m]}${yr}`;
  return `${a.d} ${MONTH[a.m]}–${b.d} ${MONTH[b.m]}${yr}`;
}

export interface WeekNav {
  /** The Monday of the week on screen. */
  monday: string;
  /** "10–16 nov". */
  label: string;
  /** The week on screen is the one that holds today. */
  current: boolean;
  prevHref: string;
  nextHref: string;
  /** Back to today (the URL without `dia`); null when today is already selected. */
  thisHref: string | null;
}

/** Previous and next week keep the weekday and the view: `?dia=` moves by seven calendar days (year changes included). */
export function weekNav(day: string, view: "hoy" | "semana", today: string): WeekNav {
  const monday = mondayOf(day);
  return {
    monday,
    label: weekLabel(monday, today),
    current: monday === mondayOf(today),
    prevHref: calendarHref(addDays(day, -7), view),
    nextHref: calendarHref(addDays(day, 7), view),
    thisHref: day === today ? null : calendarHref(null, view),
  };
}

export interface OutsideNote {
  /** The line that explains why there is nothing (or not everything) to show. */
  text: string;
  /** Where the same days are in Google Calendar. */
  href: string;
  linkText: string;
  /** None of it is stored: the empty-agenda sentence would be false. */
  whole: boolean;
}

/** A day or week the poller does not keep (13 weeks back, 26 ahead): say so and point to Google Calendar. Null when it is all stored. */
export function outsideNote(day: string, view: "hoy" | "semana", today: string): OutsideNote | null {
  const monday = mondayOf(day);
  const [from, to] = view === "semana" ? [monday, addDays(monday, 7)] : [day, addDays(day, 1)];
  const cov = coverageOf(from, to, today);
  if (cov === "in") return null;
  const this_ = view === "semana" ? "esta semana" : "este día";
  const kept = `${STORED_BACK_DAYS / 7} semanas atrás y ${STORED_AHEAD_DAYS / 7} adelante`;
  return {
    text: cov === "out" ? `${this_[0]!.toUpperCase()}${this_.slice(1)} queda fuera de lo que Mesa guarda (${kept}), por eso no ves reuniones aquí.` : `Parte de esta semana queda fuera de lo que Mesa guarda (${kept}).`,
    href: view === "semana" ? googleWeekUrl(monday) : googleDayUrl(day),
    linkText: `Ver ${this_} en Google Calendar`,
    whole: cov === "out",
  };
}
