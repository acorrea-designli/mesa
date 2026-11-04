import { body, json, route } from "@/lib/api/http";
import { briefInput } from "@/lib/api/schemas";

/** GET /api/tickets/:id/brief -> { brief: Brief | null } */
export const GET = route<{ id: string }>((_req, r, { id }) => json({ brief: r.agents.brief(id) }));

/** PUT /api/tickets/:id/brief BriefInput -> { brief } (fields given replace; revision + 1) */
export const PUT = route<{ id: string }>(async (req, r, { id }) => json({ brief: r.agents.putBrief(id, await body(req, briefInput)) }));
