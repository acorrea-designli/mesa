import { error, json, route } from "@/lib/api/http";
import { SANDBOX_REFUSAL, isSandbox } from "@/lib/env";
import { calendarWorker } from "@/lib/integrations/calendar-worker";

export const dynamic = "force-dynamic";

/**
 * POST /api/calendar/refresh -> { run }: read the feed now ("Actualizar"), ignoring the cadence and the backoff.
 * 409 `sandbox` in sandbox (no fetch), 409 `not_configured` without MESA_GCAL_ICS_URL. A failed read is 200 with
 * `run.state: "error"` and a fixed phrase (never the address).
 */
export const POST = route(async () => {
  if (isSandbox()) return error(409, "sandbox", SANDBOX_REFUSAL);
  const run = await calendarWorker().run({ force: true });
  if (run.state === "off") return error(409, "not_configured", "MESA_GCAL_ICS_URL is not set");
  return json({ run });
});
