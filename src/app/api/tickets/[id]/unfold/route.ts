import { body, json, route } from "@/lib/api/http";
import { ticketUnfold } from "@/lib/api/schemas";

/**
 * POST /api/tickets/:id/unfold { ticket: id|ref } -> TicketDetail (the reopened ticket).
 * Andrés splits a folded ticket out of the primary `:id`: it reopens unclaimed, its card points back at it, and the
 * lead gets ticket.created { ticketRef, taskId, kind?, splitFrom }. 409 when it was not folded into that primary.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(r.tickets.unfold(id, (await body(req, ticketUnfold)).ticket)));
