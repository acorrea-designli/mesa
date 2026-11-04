import { z } from "zod";
import { body, json, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

const input = z.object({ ticket: z.string().min(1) });

/** GET /api/lead/focus -> { ticketRef, expiresAt } (nulls when none, expired, or the ticket is closed). The approval hook reads it for the lead's prompts */
export const GET = route((_req, r) => {
  const f = r.focus.current();
  return json({ ticketRef: f?.ticketRef ?? null, expiresAt: f?.expiresAt ?? null });
});

/** PUT /api/lead/focus { ticket } -> { ticketRef, expiresAt }. "mesa lead focus <ref>"; sets or refreshes the 2 h window. 404 unknown ticket, 409 closed */
export const PUT = route(async (req, r) => {
  r.focus.set((await body(req, input)).ticket);
  const f = r.focus.current();
  return json({ ticketRef: f?.ticketRef ?? null, expiresAt: f?.expiresAt ?? null });
});

/** DELETE /api/lead/focus -> { ticketRef: null }. "mesa lead focus --clear" and the Hoy, Permisos button */
export const DELETE = route((_req, r) => {
  r.focus.clear();
  return json({ ticketRef: null, expiresAt: null });
});
