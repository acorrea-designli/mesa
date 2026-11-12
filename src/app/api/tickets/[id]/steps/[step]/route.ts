import { body, json, route } from "@/lib/api/http";
import { stepSet } from "@/lib/api/schemas";

/**
 * PUT /api/tickets/:id/steps/:step { done, note? } -> TicketDetail (t124). `:step` is a step id, `<message id>.<n>` or a
 * bare n (only while one checklist of the ticket has it). A call from the Mesa CLI (`x-mesa-client: cli`) is Claude
 * marking a step it verified (doneBy "claude", with its note); any other call is Andrés (doneBy "andres": his turn,
 * and the owner wakes with ticket.checklist). 404 unknown step, 400 ambiguous n or bad body, 409 closed ticket.
 */
export const PUT = route<{ id: string; step: string }>(async (req, r, { id, step }) => {
  const b = await body(req, stepSet);
  const by = req.headers.get("x-mesa-client") === "cli" ? "claude" : "andres";
  return json(r.tickets.setStep(id, step, { done: b.done, by, note: b.note }));
});
