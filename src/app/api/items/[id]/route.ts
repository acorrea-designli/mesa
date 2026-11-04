import { body, json, route } from "@/lib/api/http";
import { itemPatch } from "@/lib/api/schemas";

type P = { id: string };

/** GET /api/items/:id -> Item */
export const GET = route<P>((_req, r, { id }) => json(r.items.get(id)));

/** PATCH /api/items/:id ItemPatch -> Item */
export const PATCH = route<P>(async (req, r, { id }) => json(r.items.update(id, await body(req, itemPatch))));

/** DELETE /api/items/:id -> 204 */
export const DELETE = route<P>((_req, r, { id }) => {
  r.items.remove(id);
  return new Response(null, { status: 204 });
});
