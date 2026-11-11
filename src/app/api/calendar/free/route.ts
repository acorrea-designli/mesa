import { json, query, route } from "@/lib/api/http";
import { ValidationError } from "@/lib/db/util";
import { bogotaStart, freeSlots } from "@/lib/domain/calendar";
import { addDays, localDay } from "@/lib/domain/week";

export const dynamic = "force-dynamic";

/**
 * GET /api/calendar/free?day=YYYY-MM-DD[&minutes=30][&open=08:00&close=19:00] -> { day, slots: [{ start, end }] }: the
 * free gaps of one Bogota day inside working hours, from the stored events (what `mesa calendar free` prints). Today
 * starts at the present moment. Claude proposes a meeting from these; nothing is created here.
 */
export const GET = route((req, r) => {
  const q = query(req);
  const now = new Date();
  const day = q.get("day") ?? localDay(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ValidationError("day must be YYYY-MM-DD");
  const minutes = Number(q.get("minutes") ?? 30);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) throw new ValidationError("minutes must be 5 to 480");
  const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const open = q.get("open") ?? "08:00";
  const close = q.get("close") ?? "19:00";
  if (!hm.test(open) || !hm.test(close) || close <= open) throw new ValidationError("open and close must be HH:MM, close after open");
  const events = r.calendar.list({ from: new Date(bogotaStart(day)), to: new Date(bogotaStart(addDays(day, 1))) });
  const notBefore = day === localDay(now) ? now : undefined;
  return json({ day, slots: freeSlots(events, day, { minMinutes: minutes, open, close, notBefore }) });
});
