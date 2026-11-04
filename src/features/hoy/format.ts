// Spanish date and time labels for the board. Formatted on the server so the
// client never re-formats (no hydration drift between the PC and the phone).

const CLOCK = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit", hour12: false });
const WEEKDAY = new Intl.DateTimeFormat("es", { weekday: "short" });
const DAY_MONTH = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });
const LONG_DAY = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "short" });
const SHORT_DAY = new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short" });

const clean = (s: string) => s.replace(/\./g, "").replace(/,/g, "");

/** "10:42" */
export function clock(iso: string | Date): string {
  return CLOCK.format(typeof iso === "string" ? new Date(iso) : iso);
}

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Board time: "10:42" today, "ayer", "lun" this week, then "3 nov". */
export function when(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000);
  if (days <= 0) return clock(d);
  if (days === 1) return "ayer";
  if (days < 7) return clean(WEEKDAY.format(d));
  return clean(DAY_MONTH.format(d));
}

/** "martes 3 nov" */
export function longDay(now: Date = new Date()): string {
  return clean(LONG_DAY.format(now));
}

/** "mar 3 nov" */
export function shortDay(now: Date = new Date()): string {
  return clean(SHORT_DAY.format(now));
}

/** "hace 2 min", "hace 3 h", "ayer 17:20" */
export function ago(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (s < 60) return "hace un momento";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 12) return `hace ${h} h`;
  return `${when(iso, now)} ${clock(iso)}`.replace(/^(\d\d:\d\d) \1$/, "$1");
}

export const isToday = (iso: string, now: Date = new Date()) => startOfDay(new Date(iso)).getTime() === startOfDay(now).getTime();
