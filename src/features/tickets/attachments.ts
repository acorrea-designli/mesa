// Where each attachment of a ticket thread shows (t135). Pure, so the rule is unit tested.
import { groupDocuments } from "@/lib/domain/attachments";
import type { Attachment, TicketMessage } from "@/lib/domain/types";

export interface Placement {
  /** Attachments by message id: an attachment shows only under the message it arrived with. */
  byMessage: Map<string, Attachment[]>;
  /** Attachments with no message (or whose message is gone): the end of the thread, after the last message. */
  tail: Attachment[];
}

export function placeAttachments(attachments: Attachment[], messages: Pick<TicketMessage, "id">[]): Placement {
  const known = new Set(messages.map((m) => m.id));
  const byMessage = new Map<string, Attachment[]>();
  const tail: Attachment[] = [];
  for (const a of attachments) {
    if (a.messageId && known.has(a.messageId)) byMessage.set(a.messageId, [...(byMessage.get(a.messageId) ?? []), a]);
    else tail.push(a);
  }
  return { byMessage, tail };
}

export const isPdf = (a: Pick<Attachment, "mime">) => a.mime === "application/pdf";

/** One PDF per document, its latest version (t190): what the header's "Revisar PDF" lists. Oldest document first. */
export const latestPdfs = (atts: Attachment[]): Attachment[] => groupDocuments(atts.filter(isPdf)).map((d) => d.latest);

/** Attachment id -> id of the latest version of its document (every version of a PDF document maps to the newest). */
export function reviewTargets(atts: Attachment[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of groupDocuments(atts)) for (const v of d.versions) out.set(v.id, d.latest.id);
  return out;
}
