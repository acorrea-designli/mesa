import { json, route } from "@/lib/api/http";

/** POST /api/tickets/seen -> { count, seenAt }. "Marcar todo como leído": clears the "new" flag of every unread ticket. */
export const POST = route((_req, r) => json(r.tickets.markAllSeen()));
