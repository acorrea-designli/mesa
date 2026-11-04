import { body, json, query, route } from "@/lib/api/http";
import { itemInput, source, station } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/items?station=&source= -> Item[] */
export const GET = route((req, r) => {
  const q = query(req);
  return json(
    r.items.list({
      station: q.get("station") ? station.parse(q.get("station")) : undefined,
      source: q.get("source") ? source.parse(q.get("source")) : undefined,
    }),
  );
});

/** POST /api/items ItemInput -> Item (201) */
export const POST = route(async (req, r) => json(r.items.create(await body(req, itemInput)), { status: 201 }));
