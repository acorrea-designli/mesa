import { body, json, route } from "@/lib/api/http";
import { annotationSend } from "@/lib/api/annotation-schemas";

/**
 * POST /api/tickets/:id/annotations/send { attachmentId } -> { count, annotationIds }
 * "Enviar a Claude (n)": ONE ticket.annotations wake for Andrés's open marks on that PDF not sent yet. 409 when none.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const b = await body(req, annotationSend);
  return json(r.annotations.send(id, b.attachmentId));
});
