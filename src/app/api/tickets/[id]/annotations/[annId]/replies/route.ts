import { body, json, route } from "@/lib/api/http";
import { annotationReply, callerOf } from "@/lib/api/annotation-schemas";

/** POST /api/tickets/:id/annotations/:annId/replies { body } -> Annotation (201). From the CLI the reply is Claude's, from the board Andrés's */
export const POST = route<{ id: string; annId: string }>(async (req, r, { id, annId }) =>
  json(r.annotations.reply(id, annId, { author: callerOf(req), body: (await body(req, annotationReply)).body }), { status: 201 }),
);
