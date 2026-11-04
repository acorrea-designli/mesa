import { body, json, route } from "@/lib/api/http";
import { ticketPlanApprove } from "@/lib/api/schemas";

/** POST /api/tickets/:id/plan/approve { reject?: actionId[] } -> TicketDetail (wakes the owner) */
export const POST = route<{ id: string }>(async (req, r, { id }) =>
  json(r.tickets.approvePlan(id, (await body(req, ticketPlanApprove)).reject)),
);
