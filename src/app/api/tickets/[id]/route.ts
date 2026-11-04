import { json, route } from "@/lib/api/http";

/** GET /api/tickets/:idOrRef -> TicketDetail */
export const GET = route<{ id: string }>((_req, r, { id }) => json(r.tickets.detail(id)));
