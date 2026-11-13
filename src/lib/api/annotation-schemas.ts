// Request bodies of the PDF review routes (t125). Geometry is checked per kind by the repo (domain/annotations.ts).
import { z } from "zod";
import { ANNOTATION_KINDS } from "../domain/annotations";
import type { Author } from "../domain/types";

export const annotationCreate = z.object({
  attachmentId: z.string().min(1),
  page: z.number().int().min(0), // 0 is only for a general comment on the whole document (the repo checks it)
  kind: z.enum(ANNOTATION_KINDS as [string, ...string[]]),
  geometry: z.unknown().optional(), // a general comment has none
  quote: z.string().optional(),
  body: z.string().optional(),
});

export const annotationPatch = z.object({
  body: z.string().optional(),
  state: z.enum(["open", "resolved"]).optional(),
});

export const annotationReply = z.object({ body: z.string().min(1) });

export const annotationSend = z.object({ attachmentId: z.string().min(1) });

/** "Terminé" on a PDF (t135): true marks it reviewed, false takes it back. */
export const attachmentReviewed = z.object({ reviewed: z.boolean() });

/** Who is calling: the CLI (bin/mesa sends x-mesa-client: cli, only the lead and the agents use it) is Claude; the board is Andrés. */
export const callerOf = (req: Request): Author => (req.headers.get("x-mesa-client") === "cli" ? "claude" : "andres");
