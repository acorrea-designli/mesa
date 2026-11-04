import { body, json, route } from "@/lib/api/http";
import { sessionInput } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/sessions -> (Session & { listening })[] */
export const GET = route((_req, r) => json(r.sessions.list().map((s) => ({ ...s, listening: r.sessions.isListening(s) }))));

/** POST /api/sessions { id, label?, cwd?, project? } -> Session (register or heartbeat) */
export const POST = route(async (req, r) => json(r.sessions.touch(await body(req, sessionInput))));
