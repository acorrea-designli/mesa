import { body, error, json, route } from "@/lib/api/http";
import { sweepInput } from "@/lib/api/schemas";
import { isSandbox, SANDBOX_REFUSAL } from "@/lib/env";

/**
 * POST /api/sweep { sources? } -> { event } ("Barrer ahora": wakes the sweeper session with
 * sweep.requested). 409 `sandbox` on the sandbox board: nobody sweeps the real Slack or Basecamp from it.
 */
export const POST = route(async (req, r) => {
  if (isSandbox()) return error(409, "sandbox", SANDBOX_REFUSAL);
  return json({ event: r.requestSweep((await body(req, sweepInput)).sources) }, { status: 202 });
});
