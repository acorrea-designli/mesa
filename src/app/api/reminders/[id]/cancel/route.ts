import { json, route } from "@/lib/api/http";

/** POST /api/reminders/:id/cancel -> Reminder. A pending reminder will not fire (404 unknown, 409 once fired, done or cancelled). */
export const POST = route<{ id: string }>(async (_req, r, { id }) => json(r.reminders.cancel(id)));
