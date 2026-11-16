import { body, json, query, route } from "@/lib/api/http";
import { reminderCreate } from "@/lib/api/schemas";
import { ValidationError } from "@/lib/db/util";
import { parseWhen } from "@/lib/domain/reminders";

export const dynamic = "force-dynamic";

/** GET /api/reminders[?all=1] -> { reminders } the open ones (pending and fired, soonest first); all=1 adds done and cancelled. */
export const GET = route((req, r) => json({ reminders: r.reminders.list({ all: query(req).get("all") === "1" }) }));

/**
 * POST /api/reminders { when, text, ticket? } -> Reminder. `when` is "2026-11-18T09:00" (Bogota), "2026-11-18" (09:00 Bogota) or a
 * full ISO instant. 400 on an unreadable or past date, an empty or over-long text; 404 on an unknown `ticket`.
 * It shows in Hoy and fires as a push when it is due.
 */
export const POST = route(async (req, r) => {
  const b = await body(req, reminderCreate);
  const dueAt = parseWhen(b.when);
  if (!dueAt) throw new ValidationError(`cannot read "${b.when}" as a date (want 2026-11-18T09:00, Bogota time)`);
  return json(r.reminders.create({ text: b.text, dueAt, ticketRef: b.ticket }), { status: 201 });
});
