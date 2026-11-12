import { body, json, route } from "@/lib/api/http";
import { attachmentReviewed } from "@/lib/api/annotation-schemas";

/**
 * PUT /api/tickets/:id/attachments/:attId/reviewed { reviewed } -> Attachment
 * "Terminé" (t135): the PDF is marked as reviewed, or taken back (reviewed false). 404 when the PDF is not on the
 * ticket, 400 when the attachment is not a PDF. Documentos reads this flag and nothing else.
 */
export const PUT = route<{ id: string; attId: string }>(async (req, r, { id, attId }) => {
  const b = await body(req, attachmentReviewed);
  return json(r.annotations.setReviewed(id, attId, b.reviewed));
});
