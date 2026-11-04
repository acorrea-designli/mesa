import { body, json, route } from "@/lib/api/http";
import { ticketPlan } from "@/lib/api/schemas";

/** POST /api/tickets/:id/plan { actions, session? } -> TicketDetail (the "Claude va a hacer" plan) */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const p = await body(req, ticketPlan);
  return json(r.tickets.plan(id, p.actions, p.session));
});
