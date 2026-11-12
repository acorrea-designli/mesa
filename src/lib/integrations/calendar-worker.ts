// The server-side Calendario poller, started from src/instrumentation.ts (t112).
//  - reads Andrés's private iCal (ICS) feed about every 5 minutes (MESA_GCAL_ICS_URL, a secret in .env.local);
//  - on failure it backs off (10, 20, 40, 60 min) and the rail shows "Calendario" as degraded, then down;
//  - parses the feed into the occurrences of 13 weeks back to 26 weeks ahead and replaces the stored, non-sample rows.
// Health goes to the source_state row "calendar". Read only: nothing here writes to Google; creating an event is a
// salida the lead makes through the Google Calendar connector. Without the variable it does nothing (the screen
// says "Calendario sin conectar"); in sandbox (MESA_ENV=sandbox) it never starts and never fetches.
import { calendarEnabled, rememberCalendarName } from "./calendar-env";
import { FeedError, feedConfig, fetchFeed, type Env, type FetchLike } from "./calendar-feed";
import { STORED_AHEAD_DAYS, STORED_BACK_DAYS } from "../domain/calendar";
import { parseIcs } from "../domain/ics";
import { localDay } from "../domain/week";
import { publishChange } from "../live/bus";
import { repos, type Repos } from "../repo";

export { calendarEnabled } from "./calendar-env";

const TICK_MS = 30_000;
const BASE_S = 300;
const MAX_BACKOFF_S = 3600;
const DAY = 86_400_000;
/** The window the table keeps: 13 weeks back to 26 weeks ahead of today (Bogota, t127). */
export const WINDOW_BACK_DAYS = STORED_BACK_DAYS;
export const WINDOW_AHEAD_DAYS = STORED_AHEAD_DAYS;

export type CalendarRun =
  | { state: "off" }
  | { state: "invalid" }
  | { state: "skipped"; reason: "not_due" | "busy" }
  | { state: "ok"; inserted: number; removed: number; skippedEvents: number }
  | { state: "error"; error: string };

export class CalendarWorker {
  private busy: Promise<CalendarRun> | null = null;

  constructor(
    private r: Repos,
    private fetchImpl?: FetchLike,
    private env: Env = process.env,
  ) {}

  /** One pass. Concurrent callers share the pass in flight (POST /api/calendar/refresh during a tick). */
  run(o: { force?: boolean; now?: Date } = {}): Promise<CalendarRun> {
    if (this.busy) return this.busy;
    this.busy = this.pass(o).finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async pass(o: { force?: boolean; now?: Date }): Promise<CalendarRun> {
    const now = o.now ?? new Date();
    const cfg = feedConfig(this.env);
    if (cfg.state === "off") return { state: "off" };
    if (cfg.state === "invalid") {
      this.fail(now, "la dirección del calendario en .env.local no es una URL https", 0, true);
      return { state: "invalid" };
    }
    const prev = this.r.sources.get("calendar");
    if (!o.force) {
      if (prev.backoffUntil && Date.parse(prev.backoffUntil) > now.getTime()) return { state: "skipped", reason: "not_due" };
      if (prev.lastChecked && Date.parse(prev.lastChecked) + prev.cadenceS * 1000 > now.getTime()) return { state: "skipped", reason: "not_due" };
    }
    try {
      const text = await fetchFeed(cfg.config, this.fetchImpl);
      const from = new Date(Date.parse(`${localDay(now)}T00:00:00-05:00`) - WINDOW_BACK_DAYS * DAY);
      const to = new Date(from.getTime() + (WINDOW_BACK_DAYS + WINDOW_AHEAD_DAYS) * DAY);
      const parsed = parseIcs(text, { from, to, ownerEmail: cfg.config.ownerEmail });
      rememberCalendarName(parsed.calendarName);
      const res = this.r.calendar.replace(parsed.occurrences, now);
      this.r.sources.set(
        "calendar",
        { health: "ok", note: parsed.skipped ? `${parsed.skipped} evento(s) ilegibles` : "", lastChecked: now.toISOString(), lastNewAt: now.toISOString(), cadenceS: BASE_S, backoffUntil: null, errorCount: 0, lastError: null, watermark: `${res.inserted} eventos` },
        now,
      );
      publishChange({ entityType: "calendar", entityId: "", kind: "refresh" });
      if (prev.health !== "ok") publishChange({ entityType: "source", entityId: "calendar", kind: "health" });
      return { state: "ok", inserted: res.inserted, removed: res.removed, skippedEvents: parsed.skipped };
    } catch (err) {
      const message = err instanceof FeedError ? err.message : "no pude leer el calendario";
      this.fail(now, message, prev.errorCount + 1, false);
      return { state: "error", error: message };
    }
  }

  private fail(now: Date, message: string, errorCount: number, hard: boolean) {
    const prev = this.r.sources.get("calendar");
    const backoffS = Math.min(BASE_S * 2 ** Math.max(0, errorCount), MAX_BACKOFF_S);
    const health = hard || errorCount >= 3 ? "down" : "degraded";
    this.r.sources.set(
      "calendar",
      {
        health,
        note: message,
        lastChecked: now.toISOString(),
        errorCount,
        lastError: message, // a fixed phrase: never the address
        cadenceS: BASE_S,
        backoffUntil: hard ? null : new Date(now.getTime() + backoffS * 1000).toISOString(),
      },
      now,
    );
    if (prev.health !== health || prev.note !== message) publishChange({ entityType: "source", entityId: "calendar", kind: "health" });
  }
}

const g = globalThis as unknown as { __mesaCalendar?: { worker: CalendarWorker; timer: NodeJS.Timeout | null } };

/** The app's worker over the shared repositories. */
export function calendarWorker(): CalendarWorker {
  g.__mesaCalendar ??= { worker: new CalendarWorker(repos()), timer: null };
  return g.__mesaCalendar.worker;
}

/** Start the loop (idempotent across hot reloads). A board without the variable never starts it. */
export function startCalendarWorker(): void {
  if (!calendarEnabled()) return;
  const worker = calendarWorker();
  const state = g.__mesaCalendar!;
  if (state.timer) return;
  const tick = () => void worker.run().catch(() => console.error("[mesa] calendar read failed"));
  state.timer = setInterval(tick, TICK_MS);
  state.timer.unref();
  console.info(`[mesa] calendar poller on; the iCal feed is read about every ${BASE_S / 60} min`);
  tick();
}
