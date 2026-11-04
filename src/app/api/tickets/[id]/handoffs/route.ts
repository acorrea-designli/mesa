import { body, json, route } from "@/lib/api/http";
import { handoffInput } from "@/lib/api/schemas";

/** GET /api/tickets/:id/handoffs -> { handoffs } newest first */
export const GET = route<{ id: string }>((_req, r, { id }) => json({ handoffs: r.agents.handoffs({ ticket: id }) }));

/** POST /api/tickets/:id/handoffs HandoffInput -> { handoff } (append-only) */
export const POST = route<{ id: string }>(async (req, r, { id }) =>
  json({ handoff: r.agents.addHandoff(id, await body(req, handoffInput)) }, { status: 201 }),
);
