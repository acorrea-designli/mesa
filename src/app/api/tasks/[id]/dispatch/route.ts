import { body, json, route } from "@/lib/api/http";
import { taskDispatch } from "@/lib/api/schemas";

/**
 * POST /api/tasks/:id/dispatch { kind? } -> { task, ticket: { id, ref }, created }
 * "Dárselo a Claude": a linked andres_asks ticket and one ticket.created wake to the lead.
 * Idempotent (a card with an open ticket returns it, created: false). Sample cards: 409.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(r.dispatch.dispatch(id, await body(req, taskDispatch))));
