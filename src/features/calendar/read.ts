// Server read model for Calendario (t112): the week's events, the connection and the open meeting requests.
import { TICKET_STATUS_LABEL } from "@/lib/domain/ticket-machine";
import type { CalendarPayload } from "@/lib/domain/types";
import { addDays, localDay, mondayOf } from "@/lib/domain/week";
import { calendarPayload } from "@/lib/integrations/calendar-view";
import type { Repos } from "@/lib/repo";

export interface MeetingRequest {
  ref: string;
  title: string;
  statusLabel: string;
  /** A calendar salida of that ticket waiting for his signature. */
  salidaId: string | null;
}

export interface CalendarPageData {
  payload: CalendarPayload;
  /** The selected Bogota day, YYYY-MM-DD. */
  day: string;
  view: "hoy" | "semana";
  requests: MeetingRequest[];
  /** Some event is stored (any week): a week with nothing in it is still a connected calendar, not "sin conectar". */
  hasStored: boolean;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Parse the URL: a bad `dia` falls back to today, `vista=semana` is the whole week. */
export function parseCalendarQuery(raw: { dia?: string | string[]; vista?: string | string[] }, now: Date): { day: string; view: "hoy" | "semana" } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const dia = one(raw.dia);
  const day = dia && YMD.test(dia) && !Number.isNaN(Date.parse(`${dia}T00:00:00Z`)) ? dia : localDay(now);
  return { day, view: one(raw.vista) === "semana" ? "semana" : "hoy" };
}

export function loadCalendar(r: Repos, q: { day: string; view: "hoy" | "semana" }, now = new Date()): CalendarPageData {
  const mon = mondayOf(q.day);
  const payload = calendarPayload(r, { fromDay: mon, toDay: addDays(mon, 7) }, now);
  const pending = r.salidas.list({ status: ["pending", "scheduled", "queued_until_back"] }).filter((s) => s.source === "calendar");
  const requests = r.tickets
    .list({ open: true })
    .filter((t) => t.direction === "andres_asks" && t.title.startsWith("Reunión:") && !t.isSample)
    .slice(0, 3)
    .map((t) => ({
      ref: t.ref,
      title: t.title.replace(/^Reunión:\s*/, ""),
      statusLabel: TICKET_STATUS_LABEL[t.status],
      salidaId: pending.find((s) => s.ticketId === t.id)?.id ?? null,
    }));
  const stored = r.calendar.count();
  return { payload, day: q.day, view: q.view, requests, hasStored: stored.real + stored.samples > 0 };
}
