import { json, route } from "@/lib/api/http";

/** POST /api/reminders/:id/done -> Reminder. "Hecho": a fired reminder leaves Hoy (404 unknown, 409 unless it fired). */
export const POST = route<{ id: string }>(async (_req, r, { id }) => json(r.reminders.done(id)));
