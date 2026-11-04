import { body, json, route } from "@/lib/api/http";
import { taskBatch } from "@/lib/api/schemas";

/**
 * POST /api/tasks/batch, one transaction, published to /api/stream once:
 *  { action: "move", ids, station }     -> { tasks, previous: [{ id, station }] }  (each card "Sin sincronizar" until acked)
 *  { action: "dispatch", ids, kind? }    -> { results: [{ task, ticket, created }], skipped: [{ id, reason }] }
 *  { action: "restore", moves }          -> { tasks, previous }  (Deshacer of a batch move)
 * An unknown id rolls the whole batch back (404).
 */
export const POST = route(async (req, r) => {
  const b = await body(req, taskBatch);
  if (b.action === "move") return json(r.tasks.moveMany(b.ids, b.station));
  if (b.action === "restore") return json(r.tasks.restore(b.moves));
  return json(r.dispatch.dispatchMany(b.ids, { kind: b.kind }));
});
