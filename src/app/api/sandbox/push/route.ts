import { body, error, json, route } from "@/lib/api/http";
import { sandboxPushInput } from "@/lib/api/schemas";
import { gateSandboxOnly } from "@/lib/domain/sandbox";
import { isSandbox } from "@/lib/env";

/**
 * POST /api/sandbox/push { ref, sha? } -> { ticket, repo, pr, reopened, oldHead, newHead }
 * Sandbox only (409 `not_sandbox` in live): records a new head, random when `sha` is omitted, for the PR of the
 * review on that ticket and runs reviews.noteHead, the same function the GitHub poll uses, so a closed ticket
 * reopens exactly as a real push would reopen it.
 */
export const POST = route(async (req, r) => {
  const gate = gateSandboxOnly(isSandbox(), "a simulated push");
  if (!gate.ok) return error(409, gate.code, gate.error);
  const i = await body(req, sandboxPushInput);
  return json(r.reviews.simulatePush(i.ref, i.sha));
});
