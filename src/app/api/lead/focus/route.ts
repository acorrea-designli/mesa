import { z } from "zod";
import { body, json, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

const input = z.object({ ticket: z.string().min(1) });

/** GET /api/lead/focus -> { ticketRef } (null when none, or the ticket is closed). The approval hook reads it for the lead's prompts */
export const GET = route((_req, r) => json({ ticketRef: r.focus.get() }));

/** PUT /api/lead/focus { ticket } -> { ticketRef }. "mesa lead focus <ref>". 404 unknown ticket, 409 closed */
export const PUT = route(async (req, r) => json({ ticketRef: r.focus.set((await body(req, input)).ticket) }));

/** DELETE /api/lead/focus -> { ticketRef: null }. "mesa lead focus --clear" */
export const DELETE = route((_req, r) => {
  r.focus.clear();
  return json({ ticketRef: null });
});
