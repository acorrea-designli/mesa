import { body, json, route } from "@/lib/api/http";
import { taskSync } from "@/lib/api/schemas";

/** POST /api/tasks/:id/sync { syncState, ghItemId?, ghContentUrl?, syncError? } -> Task */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(r.tasks.markSync(id, await body(req, taskSync))));
