import { error, json, route } from "@/lib/api/http";
import { importPrMonitorState, PR_MONITOR_STATE, readPrMonitorState } from "@/lib/integrations/pr-monitor";

export const dynamic = "force-dynamic";

/** POST /api/github/import-reviews -> ImportResult. Reads pr-monitor's state file (read only). */
export const POST = route((_req, r) => {
  let state: unknown;
  try {
    state = readPrMonitorState();
  } catch (err) {
    return error(404, "not_found", `cannot read ${PR_MONITOR_STATE}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return json(importPrMonitorState(r, state));
});
