import { body, json, route } from "@/lib/api/http";
import { ticketFold } from "@/lib/api/schemas";

/**
 * POST /api/tickets/:id/fold { from: [id|ref], why, session? } -> TicketDetail (the primary).
 * The lead groups same-topic tickets of a ticket.batch: the `from` tickets' cards move to the primary, their refs
 * are copied, the primary gets "Agrupé: … porque <why>", each folded ticket gets "Agrupado en tN: <why>" and closes
 * without a wake. 409 when the primary or a folded ticket is closed, a sample or not an Andrés request, or `from`
 * contains the primary.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(r.tickets.fold(id, await body(req, ticketFold))));
