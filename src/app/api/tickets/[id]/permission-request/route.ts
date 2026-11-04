import { json, route } from "@/lib/api/http";

/** POST /api/tickets/:id/permission-request -> TicketDetail. "Pídeme permiso": posts the marked andres message and wakes the owner (ticket.permission_requested). 409 on a closed ticket */
export const POST = route<{ id: string }>(async (_req, r, { id }) => json(r.tickets.requestPermission(id)));
