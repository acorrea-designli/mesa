import { body, json, route } from "@/lib/api/http";
import { ticketTransition } from "@/lib/api/schemas";

/**
 * POST /api/tickets/:id/transition { event: claim|close|reopen|pause|ongoing|resume, by?, session?, reason?, untilTicket? } -> TicketDetail
 * (reason rides on the ticket.reopened wake). pause / ongoing need a reason (400), pause may name the open ticket it waits for
 * (untilTicket: unknown, closed or itself -> 400); a closed ticket -> 409. resume by Claude -> working; by Andrés -> waiting_claude
 * and the owner wakes with ticket.resumed. `by` is Claude on a CLI call, Andrés otherwise.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const t = await body(req, ticketTransition);
  if (t.event === "pause" || t.event === "ongoing" || t.event === "resume") {
    const by = t.by ?? (req.headers.get("x-mesa-client") === "cli" ? "claude" : "andres");
    if (t.event === "resume") return json(r.tickets.resume(id, { by }));
    return json(r.tickets.pause(id, { kind: t.event === "pause" ? "paused" : "ongoing", reason: t.reason ?? "", untilTicket: t.untilTicket, by }));
  }
  const ev =
    t.event === "close"
      ? { type: "close" as const, by: t.by ?? "andres" }
      : t.event === "reopen"
        ? { type: "reopen" as const, by: t.by ?? "andres" } // only Andrés's reopen is an interaction of his
        : { type: t.event };
  return json(r.tickets.transition(id, ev, t.session, new Date(), t.reason));
});
