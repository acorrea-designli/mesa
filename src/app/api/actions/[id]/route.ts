import { body, json, route } from "@/lib/api/http";
import { actionState } from "@/lib/api/schemas";

/** PATCH /api/actions/:id { state } -> PlannedAction (the session reports running/done/failed) */
export const PATCH = route<{ id: string }>(async (req, r, { id }) =>
  json(r.tickets.setActionState(id, (await body(req, actionState)).state)),
);
