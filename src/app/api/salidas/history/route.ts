import { json, query, route } from "@/lib/api/http";
import { loadHistory } from "@/features/salidas/read";

export const dynamic = "force-dynamic";

/**
 * GET /api/salidas/history?cursor=&limit= -> { rows, next } (t204): the Historial, the salidas the queue strip no
 * longer shows, newest update first, 50 per page (`limit` up to 500). Row data only; a card opens through GET /api/salidas/:id/view.
 */
export const GET = route((req, r) => {
  const q = query(req);
  const limit = Number(q.get("limit"));
  return json(loadHistory(r, { cursor: q.get("cursor"), limit: Number.isFinite(limit) && limit > 0 ? limit : undefined }));
});
