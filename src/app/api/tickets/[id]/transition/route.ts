import { body, json, route } from "@/lib/api/http";
import { ticketTransition } from "@/lib/api/schemas";
import { ValidationError } from "@/lib/db/util";
import { parseWhen } from "@/lib/domain/reminders";

/**
 * POST /api/tickets/:id/transition { event: claim|close|reopen|pause|ongoing|resume, by?, session?, reason?, untilTicket?, untilAt? } -> TicketDetail
 * (reason rides on the ticket.reopened wake). pause / ongoing need a reason (400), pause may name the open ticket it waits for
 * (untilTicket: unknown, closed or itself -> 400); a closed ticket -> 409. resume by Claude -> working; by Andrés -> waiting_claude
 * and the owner wakes with ticket.resumed. untilAt (pause only, t191: "2026-11-18T09:00" Bogota time, a bare date = 09:00, or a full ISO
 * instant; 400 when unreadable or past) is when the ticket comes back to Claude by itself (ticket.resumed by "date" plus a push);
 * it stands in for the reason. `by` is Claude on a CLI call, Andrés otherwise.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const t = await body(req, ticketTransition);
  if (t.event === "pause" || t.event === "ongoing" || t.event === "resume") {
    const by = t.by ?? (req.headers.get("x-mesa-client") === "cli" ? "claude" : "andres");
    if (t.event === "resume") return json(r.tickets.resume(id, { by }));
    const untilAt = t.untilAt ? parseWhen(t.untilAt) : undefined;
    if (untilAt === null) throw new ValidationError(`cannot read "${t.untilAt}" as a date (want 2026-11-18T09:00, Bogota time)`);
    return json(r.tickets.pause(id, { kind: t.event === "pause" ? "paused" : "ongoing", reason: t.reason, untilTicket: t.untilTicket, untilAt, by }));
  }
  const ev =
    t.event === "close"
      ? { type: "close" as const, by: t.by ?? "andres" }
      : t.event === "reopen"
        ? { type: "reopen" as const, by: t.by ?? "andres" } // only Andrés's reopen is an interaction of his
        : { type: t.event };
  return json(r.tickets.transition(id, ev, t.session, new Date(), t.reason));
});
