import { body, json, route } from "@/lib/api/http";
import { lookingRegistry } from "@/lib/push/looking";
import { lookingInput } from "@/lib/push/schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/looking { tab, looking } -> { ok: true }
 * A visible, focused Mesa tab (desktop or phone) beats this every few seconds; each beat lives 8 s. While any
 * is alive the server sends no push. Plumbing: it never emits a live frame (QUIET in src/lib/live/bus.ts).
 */
export const POST = route(async (req) => {
  const i = await body(req, lookingInput);
  lookingRegistry().beat(i.tab, i.looking);
  return json({ ok: true });
});
