import { body, json, route } from "@/lib/api/http";
import { taskBatch } from "@/lib/api/schemas";

/**
 * POST /api/tasks/batch, one transaction, published to /api/stream once:
 *  { action: "move", ids, station }     -> { tasks, previous: [{ id, station }] }  (each card "Sin sincronizar" until acked)
 *  { action: "dispatch", ids, kind? }    -> { batchId, results: [{ task, ticket, created }], skipped: [{ id, reason }] }
 *  { action: "dispatch_items", itemIds, kind? } -> same shape: Hoy "Abrir tarea y pasar a Claude" (an item's card is reused or made)
 *  { action: "restore", moves }          -> { tasks, previous }  (Deshacer of a batch move)
 * 2+ new tickets wake the lead once with ticket.batch (batchId); one new ticket wakes with ticket.created; none, nothing.
 * An unknown id rolls the whole batch back (404).
 */
export const POST = route(async (req, r) => {
  const b = await body(req, taskBatch);
  if (b.action === "move") return json(r.tasks.moveMany(b.ids, b.station));
  if (b.action === "restore") return json(r.tasks.restore(b.moves));
  if (b.action === "dispatch_items") return json(r.dispatch.dispatchItems(b.itemIds, { kind: b.kind }));
  return json(r.dispatch.dispatchMany(b.ids, { kind: b.kind, origin: "tablero" }));
});
