import { body, json, route } from "@/lib/api/http";
import { itemInput } from "@/lib/api/schemas";

/**
 * POST /api/items/upsert ItemInput -> { item, created } (by source + externalId).
 * An item of an ignored project is not stored: -> 200 { ignored: true, created: false }.
 */
export const POST = route(async (req, r) => {
  const input = await body(req, itemInput);
  if (r.ignored.isItemIgnored(input)) return json({ ignored: true, created: false });
  const out = r.items.upsert(input);
  return json(out, { status: out.created ? 201 : 200 });
});
