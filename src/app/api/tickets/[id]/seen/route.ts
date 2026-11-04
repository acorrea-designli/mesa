import { json, route } from "@/lib/api/http";

/** POST /api/tickets/:id/seen -> { ticketId, seenAt }. Andrés opened the ticket: clears its "new" flag. */
export const POST = route<{ id: string }>((_req, r, { id }) => json(r.tickets.markSeen(id)));
