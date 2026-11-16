import { body, json, route } from "@/lib/api/http";
import { attachmentApproved, callerOf } from "@/lib/api/annotation-schemas";
import { identity } from "@/lib/config/identity";
import { ForbiddenError } from "@/lib/db/util";

/**
 * PUT /api/tickets/:id/attachments/:attId/approved { approved } -> Attachment
 * "Aprobar" (t190): Andrés approves this version of a PDF, or takes the approval back (approved false). Approving wakes
 * the ticket's owner once with ticket.document_approved { ref, ticketRef, attachmentId, version }. 404 when the PDF is
 * not on the ticket, 400 when the attachment is not a PDF, 403 for a CLI caller (Claude): only Andrés approves.
 */
export const PUT = route<{ id: string; attId: string }>(async (req, r, { id, attId }) => {
  if (callerOf(req) === "claude") throw new ForbiddenError(`only ${identity().ownerName} can approve a document`);
  const b = await body(req, attachmentApproved);
  return json(r.annotations.setApproved(id, attId, b.approved));
});
