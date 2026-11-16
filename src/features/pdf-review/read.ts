// Server loader of the PDF review view (t125): the ticket, its PDF and the marks on it.
import { NotFoundError } from "@/lib/db/util";
import { documentIdOf } from "@/lib/domain/attachments";
import type { Annotation, Attachment, Ticket } from "@/lib/domain/types";
import type { Repos } from "@/lib/repo";

export interface ReviewData {
  ticket: Pick<Ticket, "id" | "ref" | "title" | "status">;
  attachment: Attachment;
  annotations: Annotation[];
  /** t190: every version of this document, oldest first, with Andrés's own marks per version (marks stay on their version). */
  versions: { attachmentId: string; version: number; createdAt: string; approvedAt: string | null; open: number; total: number }[];
}

/**
 * null when the ticket or the attachment does not exist, or the attachment is not a PDF (the page answers 404).
 * The view shows exactly the version asked for; "Revisar" links point at the latest (see `latestPdfId`).
 */
export function loadReview(r: Repos, ticketRef: string, attachmentId: string): ReviewData | null {
  try {
    const t = r.tickets.detail(ticketRef);
    const attachment = t.attachments.find((a) => a.id === attachmentId);
    if (!attachment || attachment.mime !== "application/pdf") return null;
    const doc = documentIdOf(attachment);
    const versions = t.attachments
      .filter((a) => documentIdOf(a) === doc && a.mime === "application/pdf")
      .sort((a, b) => a.version - b.version)
      .map((a) => {
        const own = r.annotations.list(t.id, { attachmentId: a.id }).filter((m) => m.author === "andres");
        return { attachmentId: a.id, version: a.version, createdAt: a.createdAt, approvedAt: a.approvedAt, open: own.filter((m) => m.state === "open").length, total: own.length };
      });
    return { ticket: { id: t.id, ref: t.ref, title: t.title, status: t.status }, attachment, annotations: r.annotations.list(t.id, { attachmentId }), versions };
  } catch (err) {
    if (err instanceof NotFoundError || (err as Error)?.name === "NotFoundError") return null;
    throw err;
  }
}
