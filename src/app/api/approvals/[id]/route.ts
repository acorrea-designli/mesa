import { json, query, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

const MAX_WAIT_S = 55;

/** GET /api/approvals/:id?wait=SECONDS -> { approval }. With wait, holds until decided or expired */
export const GET = route<{ id: string }>(async (req, r, { id }) => {
  const wait = Math.min(Math.max(Number(query(req).get("wait") ?? 0) || 0, 0), MAX_WAIT_S);
  const approval = wait ? await r.approvals.wait(id, wait * 1000, req.signal) : r.approvals.get(id);
  return json({ approval });
});
