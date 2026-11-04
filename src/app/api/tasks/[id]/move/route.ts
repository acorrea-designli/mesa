import { body, json, route } from "@/lib/api/http";
import { taskMove } from "@/lib/api/schemas";

/** POST /api/tasks/:id/move { station, position? } -> Task (syncState "pending" until the GitHub Project write is acked) */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const m = await body(req, taskMove);
  return json(r.tasks.move(id, m.station, m.position));
});
