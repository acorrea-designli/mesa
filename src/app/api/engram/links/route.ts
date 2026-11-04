import { body, json, query, route } from "@/lib/api/http";
import { engramLink } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/engram/links?entityType=&entityId= -> EngramLink[] */
export const GET = route((req, r) => {
  const q = query(req);
  const type = engramLink.shape.entityType.parse(q.get("entityType"));
  return json(r.engram.list(type, q.get("entityId") ?? ""));
});

/** POST /api/engram/links EngramLinkInput -> EngramLink (201). Sessions record where they saved a thread */
export const POST = route(async (req, r) => json(r.engram.link(await body(req, engramLink)), { status: 201 }));
