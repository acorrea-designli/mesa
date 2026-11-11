import { json, query, route } from "@/lib/api/http";
import { ValidationError } from "@/lib/db/util";
import { addDays } from "@/lib/domain/week";
import { calendarPayload, defaultWindow } from "@/lib/integrations/calendar-view";

export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/calendar[?from=YYYY-MM-DD&to=YYYY-MM-DD] -> CalendarPayload: the stored events of Andrés's Google Calendar
 * (Bogota days, `to` exclusive, default this week and the next, at most 62 days), whether the feed is configured, the
 * source health and the next meeting. Read only; the iCal address never leaves the server.
 */
export const GET = route((req, r) => {
  const q = query(req);
  const now = new Date();
  const w = defaultWindow(now);
  const from = q.get("from") ?? w.fromDay;
  const valid = (d: string) => YMD.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
  if (!valid(from)) throw new ValidationError("from and to must be YYYY-MM-DD");
  const to = q.get("to") ?? (q.get("from") ? addDays(from, 7) : w.toDay);
  if (!valid(to)) throw new ValidationError("from and to must be YYYY-MM-DD");
  if (to <= from || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 62 * 86_400_000) throw new ValidationError("the window must be 1 to 62 days");
  return json(calendarPayload(r, { fromDay: from, toDay: to }, now));
});
