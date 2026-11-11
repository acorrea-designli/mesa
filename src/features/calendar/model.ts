// Calendario view model (pure): the agenda rows, the week stations, the health pill and the strip's words.
// Times are Bogota; everything is derived from the stored events and an explicit `now`.
import { clockOf, eventsOn, isMeeting, nextMeeting, rangeLabel, REMIND_MINUTES, shortDay, weekDays, whenLabel } from "@/lib/domain/calendar";
import type { CalendarEvent, CalendarPayload } from "@/lib/domain/types";
import { addDays, localDay } from "@/lib/domain/week";

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

