// Is the calendar feed configured on this board? Tiny and dependency free: the API routes read it too.
import { feedConfig, type Env } from "./calendar-feed";

/** True when the poller should run: a valid https MESA_GCAL_ICS_URL, not sandbox, not MESA_CALENDAR=off. */
export function calendarEnabled(env: Env = process.env): boolean {
  return feedConfig(env).state !== "off";
}

/** "off" (no variable or sandbox), "invalid" (not an https address) or "ready". The address itself never leaves feedConfig. */
export const calendarConfigState = (env: Env = process.env): "off" | "invalid" | "ready" => feedConfig(env).state;
