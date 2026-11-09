// Claude plan usage (t45), pure. The statusLine script (scripts/statusline.mjs) saves the `rate_limits` Claude
// Code hands it; this file turns that snapshot into what the rail shows: % remaining, reset time and age.
// `rate_limits` is an undocumented statusLine field: every part of it may be absent, and nothing here assumes it is there.
import { WEEK_TZ, weekOf } from "./week";

export interface RateWindow {
  /** 0-100, as Claude Code reports it (percent used). */
  usedPercentage: number;
  /** Epoch seconds when the window resets. */
  resetsAt: number;
}

export interface UsageSnapshot {
  /** ISO instant Mesa received it from the statusLine. */
  capturedAt: string;
  sessionId: string;
  model: { id: string; displayName: string };
  fiveHour: RateWindow | null;
  sevenDay: RateWindow | null;
}

/** A snapshot older than this is shown muted: the statusLine only refreshes while an interactive session is open. */
export const STALE_AFTER_MS = 15 * 60_000;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Percent remaining (0-100, whole) from percent used. */
export const remainingPercent = (usedPercentage: number): number => Math.round(clamp(100 - usedPercentage, 0, 100));

/** "hace 4 min", "hace 2 h", "hace 3 d". Under a minute reads "hace 1 min": the snapshot is never newer than its capture. */
export function ageLabel(capturedAt: string, now: Date): string {
  const min = Math.max(1, Math.floor((now.getTime() - Date.parse(capturedAt)) / 60_000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}

const clock = new Intl.DateTimeFormat("es", { timeZone: WEEK_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: WEEK_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dayName = new Intl.DateTimeFormat("es", { timeZone: WEEK_TZ, weekday: "short", day: "numeric" });

/** Reset time in Bogota: "18:30" when it is today, "vie 14 · 18:30" otherwise. */
export function resetLabel(resetsAtSec: number, now: Date): string {
  const at = new Date(resetsAtSec * 1000);
  const time = clock.format(at);
  if (dayKey.format(at) === dayKey.format(now)) return time;
  return `${dayName.format(at).replace(/[.,]/g, "")} · ${time}`;
}

export const FIVE_HOUR_MS = 5 * 3_600_000;
export const SEVEN_DAY_MS = 7 * 24 * 3_600_000;
const LENGTH_MS = { five_hour: FIVE_HOUR_MS, seven_day: SEVEN_DAY_MS } as const;

/** Share (0-1) of a window already elapsed at `now`, from its reset time and length. */
export const paceShare = (resetsAtSec: number, lengthMs: number, now: Date): number =>
  clamp((now.getTime() - (resetsAtSec * 1000 - lengthMs)) / lengthMs, 0, 1);

export interface WindowView {
  key: "five_hour" | "seven_day";
  /** "5 h" or "semana". */
  label: string;
  /** Percent remaining, or null when the window is absent or already reset (the figure is then out of date). */
  remaining: number | null;
  /** "18:30", or "" when there is no figure. */
  resets: string;
  /** Percent used as reported (0-100), or null with `remaining`. */
  used: number | null;
  /** Epoch seconds the window resets, or null with `remaining`. */
  resetsAt: number | null;
  /** Share (0-1) of the window already elapsed, or null with `remaining`: where the pace tick sits. */
  pace: number | null;
}

export interface UsageView {
  /** "none": nothing captured yet ("sin dato"). "stale": older than 15 min (muted). */
  state: "none" | "fresh" | "stale";
  age: string;
  /** Epoch ms of the capture, null when none. */
  at: number | null;
  windows: WindowView[];
  model: string;
}

const noWindow = (key: WindowView["key"], label: string): WindowView => ({ key, label, remaining: null, resets: "", used: null, resetsAt: null, pace: null });

const windowView = (key: WindowView["key"], label: string, w: RateWindow | null, now: Date): WindowView => {
  if (!w || !Number.isFinite(w.usedPercentage) || w.resetsAt * 1000 <= now.getTime()) return noWindow(key, label);
  return {
    key,
    label,
    remaining: remainingPercent(w.usedPercentage),
    resets: resetLabel(w.resetsAt, now),
    used: clamp(w.usedPercentage, 0, 100),
    resetsAt: w.resetsAt,
    pace: paceShare(w.resetsAt, LENGTH_MS[key], now),
  };
};

export function usageView(s: UsageSnapshot | null, now: Date): UsageView {
  if (!s) return { state: "none", age: "", at: null, windows: [noWindow("five_hour", "5 h"), noWindow("seven_day", "semana")], model: "" };
  const stale = now.getTime() - Date.parse(s.capturedAt) > STALE_AFTER_MS;
  return {
    state: stale ? "stale" : "fresh",
    age: ageLabel(s.capturedAt, now),
    at: Date.parse(s.capturedAt),
    windows: [windowView("five_hour", "5 h", s.fiveHour, now), windowView("seven_day", "semana", s.sevenDay, now)],
    model: s.model.displayName || s.model.id,
  };
}

// ---------- history (the % over time that the /uso charts draw) ----------

/** One reading of both windows. `t` is epoch ms; a window that was absent in the snapshot is null. */
export interface UsagePoint {
  t: number;
  fiveHourUsed: number | null;
  sevenDayUsed: number | null;
}

/** At most one point per this long. */
export const HISTORY_GAP_MS = 5 * 60_000;
/** Points older than this (before the newest one) are dropped: a week plus a day of slack. */
export const HISTORY_KEEP_MS = 8 * 24 * 3_600_000;

const pct = (w: RateWindow | null): number | null => (w && Number.isFinite(w.usedPercentage) ? Math.round(clamp(w.usedPercentage, 0, 100) * 10) / 10 : null);

/** The history point of a snapshot, or null when it carries no figure or its time is not a date. */
export function pointOf(s: UsageSnapshot): UsagePoint | null {
  const t = Date.parse(s.capturedAt);
  const point = { t, fiveHourUsed: pct(s.fiveHour), sevenDayUsed: pct(s.sevenDay) };
  return Number.isNaN(t) || (point.fiveHourUsed === null && point.sevenDayUsed === null) ? null : point;
}

/**
 * Appends `p` to a history (oldest first): skipped when it is not newer than the last point or comes less than
 * HISTORY_GAP_MS after it; points older than HISTORY_KEEP_MS before `p` are pruned. Returns the same array when nothing changed.
 */
export function appendPoint(history: UsagePoint[], p: UsagePoint): UsagePoint[] {
  const last = history[history.length - 1];
  if (last && p.t - last.t < HISTORY_GAP_MS) return history;
  const from = p.t - HISTORY_KEEP_MS;
  return [...history.filter((h) => h.t >= from), p];
}

/** One chart point: `x` is the share (0-1) of the window elapsed at `t`. */
export interface ChartPoint {
  t: number;
  x: number;
  used: number;
}

export interface ChartSeries {
  /** Epoch ms the window starts and ends. */
  start: number;
  end: number;
  points: ChartPoint[];
}

/**
 * The curve of one window: the history points inside [resets - length, resets] plus the current snapshot's own
 * figure when it is newer than the last point, so the chart ends where the meter says. Null when the window is unknown
 * (no snapshot, or it already reset), which the chart draws as "sin dato".
 */
export function chartSeries(history: UsagePoint[], w: WindowView, at: number | null): ChartSeries | null {
  if (w.resetsAt === null) return null;
  const end = w.resetsAt * 1000;
  const start = end - LENGTH_MS[w.key];
  const pick = w.key === "five_hour" ? (h: UsagePoint) => h.fiveHourUsed : (h: UsagePoint) => h.sevenDayUsed;
  const raw: { t: number; used: number }[] = [];
  for (const h of history) {
    const used = pick(h);
    if (used !== null && h.t >= start && h.t <= end) raw.push({ t: h.t, used });
  }
  const last = raw[raw.length - 1];
  if (w.used !== null && at !== null && at >= start && at <= end && (!last || at > last.t)) raw.push({ t: at, used: w.used });
  return { start, end, points: raw.map((p) => ({ ...p, x: (p.t - start) / (end - start) })) };
}

const stamp = new Intl.DateTimeFormat("es", { timeZone: WEEK_TZ, weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
/** "mar 10 · 14:35" in Bogota, for a chart point's exact time. */
export const stampLabel = (ms: number): string => stamp.format(new Date(ms)).replace(/[.,]/g, "").replace(/\s(\d{2}:)/, " · $1");

const monthDay = new Intl.DateTimeFormat("es", { timeZone: WEEK_TZ, day: "numeric", month: "short" });
const weekdayDay = new Intl.DateTimeFormat("es", { timeZone: WEEK_TZ, weekday: "short", day: "numeric", month: "short" });
const atNoon = (ymd: string) => new Date(`${ymd}T12:00:00-05:00`);

/** The /uso date line: "lun 9 nov · semana 9-15 nov" (Bogota; "semana 30 nov - 6 dic" across a month). */
export function usoDate(now: Date): string {
  const w = weekOf(now);
  const from = monthDay.format(atNoon(w.monday)).replace(/\./g, "");
  const to = monthDay.format(atNoon(w.sunday)).replace(/\./g, "");
  const range = w.monday.slice(5, 7) === w.sunday.slice(5, 7) ? `${from.split(" ")[0]}-${to}` : `${from} - ${to}`;
  return `${weekdayDay.format(now).replace(/[.,]/g, "")} · semana ${range}`;
}
