import { liveResponse } from "@/lib/live/stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/stream -> text/event-stream. `event: change` with { entityType, entityId, kind }
 * whenever the API, a wake event or the GitHub sync writes something. Use useLive() in the UI.
 */
export function GET(req: Request): Response {
  return liveResponse(req.signal);
}
