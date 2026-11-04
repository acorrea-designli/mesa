import { error, json, query, route } from "@/lib/api/http";
import { waitForEvents } from "@/lib/wake/wake";

export const dynamic = "force-dynamic";

const DEFAULT_TIMEOUT_S = 25;
const MAX_TIMEOUT_S = 55;

/**
 * GET /api/wait?session=ID&after=CURSOR&timeout=SECONDS
 * Long-poll. Returns { events, cursor } as soon as the session has events after
 * the cursor (default: its acked cursor), or { events: [], cursor } on timeout.
 * Passing `after` acks everything up to it.
 */
export const GET = route(async (req, r) => {
  const q = query(req);
  const sessionId = q.get("session");
  if (!sessionId) return error(400, "invalid_request", "session is required");
  let session = r.sessions.touch({ id: sessionId });
  const afterParam = q.get("after");
  if (afterParam !== null) session = r.sessions.ack(sessionId, Number(afterParam) || 0);
  const after = afterParam !== null ? Number(afterParam) || 0 : session.cursor;
  const timeoutS = Math.min(Math.max(Number(q.get("timeout") ?? DEFAULT_TIMEOUT_S) || 0, 0), MAX_TIMEOUT_S);
  r.sessions.setWaiting(sessionId, true);
  try {
    const events = await waitForEvents(r.db, { sessionId, after, timeoutMs: timeoutS * 1000, signal: req.signal });
    return json({ events, cursor: events.length ? events[events.length - 1]!.id : after });
  } finally {
    r.sessions.setWaiting(sessionId, false);
  }
});
