import { json, route } from "@/lib/api/http";

/** POST /api/team/:name/retire -> { agent } (idempotent) */
export const POST = route<{ name: string }>((_req, r, { name }) => json({ agent: r.agents.retireAgent(name) }));
