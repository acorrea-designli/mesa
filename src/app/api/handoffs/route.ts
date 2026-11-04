import { json, query, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/** GET /api/handoffs?agent=&ticket=&limit= -> { handoffs } newest first */
export const GET = route((req, r) => {
  const q = query(req);
  return json({
    handoffs: r.agents.handoffs({
      agent: q.get("agent") ?? undefined,
      ticket: q.get("ticket") ?? undefined,
      limit: q.get("limit") ? Number(q.get("limit")) : undefined,
    }),
  });
});
