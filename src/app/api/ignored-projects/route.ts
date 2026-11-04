import { body, json, route } from "@/lib/api/http";
import { ignoreInput } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/ignored-projects -> (IgnoredProject & { hidden: { items, tasks } })[] (open items and tasks it hides) */
export const GET = route((_req, r) => {
  const hidden = r.ignored.hiddenCounts();
  return json(r.ignored.list().map((p) => ({ ...p, hidden: hidden[p.id] ?? { items: 0, tasks: 0 } })));
});

/** POST /api/ignored-projects { source, project, label? } -> { ignored, created } (201, or 200 when already ignored) */
export const POST = route(async (req, r) => {
  const out = r.ignored.add(await body(req, ignoreInput));
  return json(out, { status: out.created ? 201 : 200 });
});
