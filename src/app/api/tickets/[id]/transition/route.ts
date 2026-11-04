import { body, json, route } from "@/lib/api/http";
import { ticketTransition } from "@/lib/api/schemas";

/** POST /api/tickets/:id/transition { event: claim|close|reopen, by?, session?, reason? } -> TicketDetail (reason rides on the ticket.reopened wake) */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const t = await body(req, ticketTransition);
  const ev =
    t.event === "close"
      ? { type: "close" as const, by: t.by ?? "andres" }
      : t.event === "reopen"
        ? { type: "reopen" as const, by: t.by ?? "andres" } // only Andrés's reopen is an interaction of his
        : { type: t.event };
  return json(r.tickets.transition(id, ev, t.session, new Date(), t.reason));
});
