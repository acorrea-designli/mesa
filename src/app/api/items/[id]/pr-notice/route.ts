import { json, route } from "@/lib/api/http";

/**
 * POST /api/items/:id/pr-notice -> { item, ticketRef, repeated }. The writer judged a Slack PR message a notice
 * (repo/intake.ts prNotice): the item goes to Hecho, the PR ticket gets one line, no salida. Idempotent (a repeat
 * returns repeated: true and changes nothing). 409 when the item is not a Slack message linked to a PR ticket.
 */
export const POST = route<{ id: string }>((_req, r, { id }) => json(r.intake.prNotice(id)));
