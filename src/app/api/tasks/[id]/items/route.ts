import { body, json, route } from "@/lib/api/http";
import { taskLink } from "@/lib/api/schemas";

/** POST /api/tasks/:id/items { itemIds } -> Task (links items; they follow the task station) */
export const POST = route<{ id: string }>(async (req, r, { id }) =>
  json(r.tasks.linkItems(id, (await body(req, taskLink)).itemIds)),
);
