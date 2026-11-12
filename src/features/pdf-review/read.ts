// Server loader of the PDF review view (t125): the ticket, its PDF and the marks on it.
import { NotFoundError } from "@/lib/db/util";
import type { Annotation, Attachment, Ticket } from "@/lib/domain/types";
import type { Repos } from "@/lib/repo";

export interface ReviewData {
  ticket: Pick<Ticket, "id" | "ref" | "title" | "status">;
  attachment: Attachment;
  annotations: Annotation[];
}

/** null when the ticket or the attachment does not exist, or the attachment is not a PDF (the page answers 404). */
export function loadReview(r: Repos, ticketRef: string, attachmentId: string): ReviewData | null {
  try {
    const t = r.tickets.detail(ticketRef);
    const attachment = t.attachments.find((a) => a.id === attachmentId);
    if (!attachment || attachment.mime !== "application/pdf") return null;
    return { ticket: { id: t.id, ref: t.ref, title: t.title, status: t.status }, attachment, annotations: r.annotations.list(t.id, { attachmentId }) };
  } catch (err) {
    if (err instanceof NotFoundError || (err as Error)?.name === "NotFoundError") return null;
    throw err;
  }
}
