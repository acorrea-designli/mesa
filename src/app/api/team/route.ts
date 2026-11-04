import { body, json, query, route } from "@/lib/api/http";
import { teamInput } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/team?status=live|retired&ticket= -> { agents } */
export const GET = route((req, r) => {
  const q = query(req);
  const status = q.get("status");
  return json({
    agents: r.agents.team({
      status: status === "live" || status === "retired" ? status : undefined,
      ticket: q.get("ticket") ?? undefined,
    }),
  });
});

/** POST /api/team { ticketRef, agent, role, owner? } -> { agent } (409 if the name was ever used) */
export const POST = route(async (req, r) => {
  const t = await body(req, teamInput);
  return json({ agent: r.agents.addAgent({ ticket: t.ticketRef, name: t.agent, role: t.role, owner: t.owner }) }, { status: 201 });
});
