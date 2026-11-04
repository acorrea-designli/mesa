import { json, query, route } from "@/lib/api/http";
import { DEFAULT_CONTEXT_MESSAGES } from "@/lib/repo/agents";

/** GET /api/tickets/:idOrRef/context?messages=20 -> TicketContext (the resume payload for a fresh agent) */
export const GET = route<{ id: string }>((req, r, { id }) => {
  const n = Number(query(req).get("messages") ?? DEFAULT_CONTEXT_MESSAGES);
  return json(r.agents.context(id, Number.isFinite(n) && n > 0 ? Math.min(n, 200) : DEFAULT_CONTEXT_MESSAGES));
});
