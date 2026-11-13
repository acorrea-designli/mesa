import { body, json, route } from "@/lib/api/http";
import { attachmentReviewed, callerOf } from "@/lib/api/annotation-schemas";
import { identity } from "@/lib/config/identity";
import { ForbiddenError } from "@/lib/db/util";

/**
 * PUT /api/tickets/:id/attachments/:attId/reviewed { reviewed } -> Attachment
 * "Terminé" (t135): the PDF is marked as reviewed, or taken back (reviewed false). 404 when the PDF is not on the
 * ticket, 400 when the attachment is not a PDF, 403 for a CLI caller (Claude): only Andrés presses "Terminé". Documentos reads this flag and nothing else.
 */
export const PUT = route<{ id: string; attId: string }>(async (req, r, { id, attId }) => {
  if (callerOf(req) === "claude") throw new ForbiddenError(`only ${identity().ownerName} can mark a PDF as reviewed`);
  const b = await body(req, attachmentReviewed);
  return json(r.annotations.setReviewed(id, attId, b.reviewed));
});
