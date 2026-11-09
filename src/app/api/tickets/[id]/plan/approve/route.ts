import { body, json, route } from "@/lib/api/http";
import { ticketPlanApprove } from "@/lib/api/schemas";

/**
 * POST /api/tickets/:id/plan/approve { reject?: actionId[] } -> TicketDetail (wakes the owner)
 * POST /api/tickets/:id/plan/approve { only: actionId[] }   -> pre-approves just those steps (wake with partial: true while others wait)
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const b = await body(req, ticketPlanApprove);
  return json(b.only ? r.tickets.approveActions(id, b.only) : r.tickets.approvePlan(id, b.reject));
});
