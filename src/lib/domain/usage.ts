// Claude plan usage (t45), pure. The statusLine script (scripts/statusline.mjs) saves the `rate_limits` Claude
// Code hands it; this file turns that snapshot into what the rail shows: % remaining, reset time and age.
// `rate_limits` is an undocumented statusLine field: every part of it may be absent, and nothing here assumes it is there.
import { WEEK_TZ } from "./week";

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

export interface WindowView {
  key: "five_hour" | "seven_day";
  /** "5 h" or "semana". */
  label: string;
  /** Percent remaining, or null when the window is absent or already reset (the figure is then out of date). */
  remaining: number | null;
  /** "18:30", or "" when there is no figure. */
  resets: string;
}

export interface UsageView {
  /** "none": nothing captured yet ("sin dato"). "stale": older than 15 min (muted). */
  state: "none" | "fresh" | "stale";
  age: string;
  windows: WindowView[];
  model: string;
}

const windowView = (key: WindowView["key"], label: string, w: RateWindow | null, now: Date): WindowView => {
  if (!w || !Number.isFinite(w.usedPercentage) || w.resetsAt * 1000 <= now.getTime()) return { key, label, remaining: null, resets: "" };
  return { key, label, remaining: remainingPercent(w.usedPercentage), resets: resetLabel(w.resetsAt, now) };
};

export function usageView(s: UsageSnapshot | null, now: Date): UsageView {
  if (!s) return { state: "none", age: "", windows: [windowView("five_hour", "5 h", null, now), windowView("seven_day", "semana", null, now)], model: "" };
  const stale = now.getTime() - Date.parse(s.capturedAt) > STALE_AFTER_MS;
  return {
    state: stale ? "stale" : "fresh",
    age: ageLabel(s.capturedAt, now),
    windows: [windowView("five_hour", "5 h", s.fiveHour, now), windowView("seven_day", "semana", s.sevenDay, now)],
    model: s.model.displayName || s.model.id,
  };
}
