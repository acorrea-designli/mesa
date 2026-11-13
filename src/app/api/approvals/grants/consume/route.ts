import { body, json, route } from "@/lib/api/http";
import { grantConsumeInput } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/approvals/grants/consume { tool, toolInput, caller, sessionId? } -> { granted, approvalId? }.
 * The PreToolUse hook (scripts/hooks/mesa-guardrails.mjs) asks it once per retried call, after every G-rule passed. The
 * server hashes the call itself and consumes an unused, unexpired grant bound to this tool, caller and session. There
 * is no route that creates a grant: only Andrés's "Permitir esta vez" press does, inside approvals.decide.
 */
export const POST = route(async (req, r) => {
  const i = await body(req, grantConsumeInput);
  return json(r.approvals.consumeGrant(i));
});
