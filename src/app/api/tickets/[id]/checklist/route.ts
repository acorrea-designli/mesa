import { body, json, route } from "@/lib/api/http";
import { ticketChecklist } from "@/lib/api/schemas";

/**
 * POST /api/tickets/:id/checklist { body?, steps: [{ text, detail? }], refs?, session? } -> TicketDetail (t124).
 * Claude posts a checklist: one Claude message with 1-30 steps for Andrés. It is a question for him (the ticket goes to
 * "Te espera" through its open steps); 400 on bad input, 409 on a closed ticket, 404 on an unknown ticket.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const b = await body(req, ticketChecklist);
  return json(r.tickets.addMessage(id, { author: "claude", body: b.body, steps: b.steps, refs: b.refs, session: b.session, ask: true }));
});
