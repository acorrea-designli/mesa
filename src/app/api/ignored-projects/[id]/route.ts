import { json, route } from "@/lib/api/http";

type P = { id: string };

/** DELETE /api/ignored-projects/:id -> the removed IgnoredProject (stop ignoring; its items and tasks come back) */
export const DELETE = route<P>((_req, r, { id }) => json(r.ignored.remove(id)));
