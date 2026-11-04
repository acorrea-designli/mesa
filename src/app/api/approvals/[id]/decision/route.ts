import { body, json, route } from "@/lib/api/http";
import { approvalDecision } from "@/lib/api/schemas";

/** POST /api/approvals/:id/decision { decision: allow|read_config|deny, actor, note? } -> { approval }. 409 after expiry or once decided */
export const POST = route<{ id: string }>(async (req, r, { id }) => json({ approval: r.approvals.decide(id, await body(req, approvalDecision)) }));
