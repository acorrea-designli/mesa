import { body, json, route } from "@/lib/api/http";
import { waitAck } from "@/lib/api/schemas";

/** POST /api/wait/ack { session, cursor } -> Session (events up to cursor are handled) */
export const POST = route(async (req, r) => {
  const a = await body(req, waitAck);
  r.sessions.touch({ id: a.session });
  return json(r.sessions.ack(a.session, a.cursor));
});
