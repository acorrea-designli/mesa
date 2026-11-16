// Reminders (t191): pure helpers for the instant a reminder or a timed pause is due. No clock, no database.
// A date with no zone is read in Bogota (UTC-5 all year, so a fixed offset), the same way the calendar reads it.
import { WEEK_TZ, localDay } from "./week";

/** A date given without a time means this hour in Bogota. */
export const DEFAULT_HOUR = "09:00";

const WITH_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(:\d{2})?)?$/;

/**
 * An ISO instant for what a person typed: "2026-11-18T09:00" (Bogota), "2026-11-18 09:00", "2026-11-18" (09:00 Bogota) or
 * a full instant with Z or an offset. Null when it is not a real date and time.
 */
export function parseWhen(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  let ms: number;
  if (WITH_ZONE.test(s)) {
    ms = Date.parse(s.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  } else {
    const m = LOCAL.exec(s);
    if (!m) return null;
    const [, ymd, hm, sec] = m;
    ms = Date.parse(`${ymd}T${hm ?? DEFAULT_HOUR}${sec ?? ":00"}-05:00`);
    // Date.parse rolls 2026-02-31 over to March; the same day coming back means it was real.
    if (Number.isFinite(ms) && localDay(new Date(ms)) !== ymd) return null;
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const WEEKDAY_DAY = new Intl.DateTimeFormat("es-CO", { timeZone: WEEK_TZ, weekday: "short", day: "numeric", month: "short" });
const CLOCK = new Intl.DateTimeFormat("es-CO", { timeZone: WEEK_TZ, hour: "numeric", minute: "2-digit", hourCycle: "h23" });

/** "9:00", "15:30" in Bogota. */
export const clockLabel = (iso: string): string => CLOCK.format(new Date(iso));

/** "mié 18 nov 9:00" in Bogota: the label that never goes stale, for text that is stored. */
export const fullLabel = (iso: string): string => `${WEEKDAY_DAY.format(new Date(iso)).replace(/\./g, "").replace(",", "").replace(/ de /g, " ")} ${clockLabel(iso)}`;

/** "hoy 15:00", "mañana 9:00", "mié 18 nov 9:00" in Bogota, relative to `now`. */
export function dueLabel(iso: string, now: Date): string {
  const day = localDay(new Date(iso));
  if (day === localDay(now)) return `hoy ${clockLabel(iso)}`;
  if (day === localDay(new Date(now.getTime() + 86_400_000))) return `mañana ${clockLabel(iso)}`;
  return fullLabel(iso);
}

/** "Vuelve mié 18 nov 9:00": what a timed pause shows on the ticket and its card. */
export const returnsLabel = (iso: string, now: Date): string => `Vuelve ${dueLabel(iso, now)}`;
