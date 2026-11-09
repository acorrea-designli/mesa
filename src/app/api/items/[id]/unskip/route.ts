import { body, json, route } from "@/lib/api/http";
import { itemUnskip } from "@/lib/api/schemas";

/** POST /api/items/:id/unskip { station, waitOn } -> Item (Deshacer: restores both, clears skippedAt) */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(r.items.unskip(id, await body(req, itemUnskip))));
