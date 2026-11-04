import { body, json, query, route } from "@/lib/api/http";
import { ticketInput } from "@/lib/api/schemas";
import type { TicketStatus } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

/** GET /api/tickets?status=&open=1 -> Ticket[] (newest activity first) */
export const GET = route((req, r) => {
  const q = query(req);
  return json(r.tickets.list({ status: (q.get("status") as TicketStatus) || undefined, open: q.get("open") === "1" }));
});

/**
 * POST /api/tickets TicketInput -> TicketDetail (201). An andres_asks ticket (Nuevo pedido) also
 * gets its card on the Claude lane (linked both ways) and wakes the lead with ticket.created.
 */
export const POST = route(async (req, r) => json(r.dispatch.createRequest(await body(req, ticketInput)), { status: 201 }));
