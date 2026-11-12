// What GET /api/calendar and the pages read (t112). Server only. The feed address never appears here.
import { isSandbox } from "../env";
import { bogotaStart, nextMeeting } from "../domain/calendar";
import { googleEventUrl } from "../domain/google-calendar";
import type { CalendarPayload } from "../domain/types";
import { addDays, localDay, mondayOf } from "../domain/week";
import type { Repos } from "../repo";
import { calendarConfigState, calendarOwnerId } from "./calendar-env";

export interface CalendarWindow {
  /** Bogota days, YYYY-MM-DD; `toDay` is exclusive. */
  fromDay: string;
  toDay: string;
}

/** This week and the next, Monday to Monday (Bogota). */
export function defaultWindow(now: Date): CalendarWindow {
  const mon = mondayOf(localDay(now));
  return { fromDay: mon, toDay: addDays(mon, 14) };
}

export function calendarPayload(r: Repos, w: CalendarWindow, now = new Date()): CalendarPayload {
  const config = calendarConfigState();
  const state = r.sources.get("calendar");
  const configured = config === "ready" || config === "invalid";
  const owner = calendarOwnerId();
  const events = r.calendar.list({ from: new Date(bogotaStart(w.fromDay)), to: new Date(bogotaStart(w.toDay)) }).map((e) => ({ ...e, googleUrl: googleEventUrl(e, owner) }));
  // The strip looks a week ahead whatever window the screen asked for.
  const ahead = r.calendar.list({ from: now, to: new Date(now.getTime() + 7 * 86_400_000) });
  return {
    now: now.toISOString(),
    configured,
    sandbox: isSandbox(),
    health: configured ? state.health : "none",
    note: configured ? state.note : "",
    lastRefresh: configured ? state.lastNewAt : null,
    lastError: configured ? state.lastError : null,
    events,
    next: nextMeeting(ahead, now),
  };
}
