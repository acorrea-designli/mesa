import { body, json, route } from "@/lib/api/http";
import { annotationPatch, callerOf } from "@/lib/api/annotation-schemas";

/** PATCH /api/tickets/:id/annotations/:annId { body?, state? } -> Annotation. The comment is its author's (403); anyone resolves or reopens */
export const PATCH = route<{ id: string; annId: string }>(async (req, r, { id, annId }) =>
  json(r.annotations.update(id, annId, await body(req, annotationPatch), callerOf(req))),
);

/** DELETE /api/tickets/:id/annotations/:annId -> 204; its author only (403) */
export const DELETE = route<{ id: string; annId: string }>((req, r, { id, annId }) => {
  r.annotations.remove(id, annId, callerOf(req));
  return new Response(null, { status: 204 });
});
