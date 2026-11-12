// Where each attachment of a ticket thread shows (t135). Pure, so the rule is unit tested.
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
