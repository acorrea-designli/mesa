import { body, error, json, route } from "@/lib/api/http";
import { approvalDecision } from "@/lib/api/schemas";
import { claimsAndres } from "@/lib/domain/approval-actor";

/**
 * POST /api/approvals/:id/decision { decision: allow|read_config|deny, actor, note? } -> { approval }. For the hook's own
 * actor. Refuses (403) any actor that names Andrés: his decisions come only from the UI routes approve / read-config /
 * deny. 409 after expiry or once decided
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const d = await body(req, approvalDecision);
  if (claimsAndres(d.actor)) return error(403, "forbidden", "only the UI routes (approve, read-config, deny) decide as andres");
  return json({ approval: r.approvals.decide(id, d) });
});
