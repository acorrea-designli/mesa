import { body, json, route } from "@/lib/api/http";
import { itemInput } from "@/lib/api/schemas";

/** POST /api/items/upsert ItemInput -> { item, created } (by source + externalId) */
export const POST = route(async (req, r) => {
  const out = r.items.upsert(await body(req, itemInput));
  return json(out, { status: out.created ? 201 : 200 });
});
