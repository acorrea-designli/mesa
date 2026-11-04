import { body, json, route } from "@/lib/api/http";
import { ticketMessage } from "@/lib/api/schemas";

/** POST /api/tickets/:id/messages MessageInput -> TicketDetail. An andres message wakes the owner (ticket.answered) */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(r.tickets.addMessage(id, await body(req, ticketMessage))));
