import { json, route } from "@/lib/api/http";

/** POST /api/items/:id/skip -> Item (done, waitOn none, skippedAt set; an upsert never reopens it) */
export const POST = route<{ id: string }>((_req, r, { id }) => json(r.items.skip(id)));
