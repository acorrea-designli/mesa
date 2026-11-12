// Is the calendar feed configured on this board? Tiny and dependency free: the API routes read it too.
import { feedConfig, type Env } from "./calendar-feed";

/** True when the poller should run: a valid https MESA_GCAL_ICS_URL, not sandbox, not MESA_CALENDAR=off. */
export function calendarEnabled(env: Env = process.env): boolean {
  return feedConfig(env).state !== "off";
}

/** "off" (no variable or sandbox), "invalid" (not an https address) or "ready". The address itself never leaves feedConfig. */
export const calendarConfigState = (env: Env = process.env): "off" | "invalid" | "ready" => feedConfig(env).state;

// The calendar id the "Abrir en Google" links need (t127). It is the owner's address: MESA_GCAL_OWNER_EMAIL, else the
// feed's own X-WR-CALNAME when that is an address (the poller remembers it after each good read). Never the feed URL.
const g = globalThis as unknown as { __mesaCalendarName?: string | null };

/** Keep the feed's calendar name for the owner fallback; a name that is not an address is dropped. */
export function rememberCalendarName(name: string | null | undefined): void {
  const n = name?.trim().toLowerCase();
  g.__mesaCalendarName = n && /^[^\s@]+@[^\s@]+$/.test(n) ? n : null;
}

/** The owner's calendar id, or null (the links then open the event's day). Nothing is returned in the sandbox. */
export function calendarOwnerId(env: Env = process.env): string | null {
  if (feedConfig(env).state === "off") return null;
  return env.MESA_GCAL_OWNER_EMAIL?.trim().toLowerCase() || g.__mesaCalendarName || null;
}
