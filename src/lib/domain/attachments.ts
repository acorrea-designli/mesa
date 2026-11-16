// Documents with versions (t190): a document is a root attachment plus the attachments that are versions of it.
// Pure, so the rule is unit tested and shared by the repo (context) and the UI (thread, Documentos, review).
import type { Attachment } from "./types";

type Versioned = Pick<Attachment, "id" | "versionOf" | "version" | "createdAt">;

export interface AttachmentDocument<T extends Versioned = Attachment> {
  /** The root attachment's id: the document's identity, stable as versions are added. */
  documentId: string;
  /** Oldest first: v1, v2, v3... */
  versions: T[];
  /** The newest version (what "Revisar" opens). */
  latest: T;
}

/** The document an attachment belongs to: the root id of its group. */
export const documentIdOf = (a: Pick<Attachment, "id" | "versionOf">): string => a.versionOf ?? a.id;

/** "v2" for a later version, "" for the first one (a document with a single version shows no tag). */
export const versionTag = (a: Pick<Attachment, "version">): string => (a.version > 1 ? `v${a.version}` : "");

/** Groups attachments into documents. Order follows each document's first appearance in `atts`. */
export function groupDocuments<T extends Versioned>(atts: T[]): AttachmentDocument<T>[] {
  const groups = new Map<string, T[]>();
  for (const a of atts) {
    const key = documentIdOf(a);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return [...groups].map(([documentId, list]) => {
    const versions = [...list].sort((a, b) => a.version - b.version || a.createdAt.localeCompare(b.createdAt));
    return { documentId, versions, latest: versions[versions.length - 1]! };
  });
}
