import { body, json, route } from "@/lib/api/http";
import { taskPatch } from "@/lib/api/schemas";

type P = { id: string };

/** GET /api/tasks/:id -> Task */
export const GET = route<P>((_req, r, { id }) => json(r.tasks.get(id)));

/** PATCH /api/tasks/:id TaskPatch -> Task (marks it unsynced) */
export const PATCH = route<P>(async (req, r, { id }) => json(r.tasks.update(id, await body(req, taskPatch))));

/** DELETE /api/tasks/:id -> 204 */
export const DELETE = route<P>((_req, r, { id }) => {
  r.tasks.remove(id);
  return new Response(null, { status: 204 });
});
