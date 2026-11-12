import { body, json, query, route } from "@/lib/api/http";
import { annotationCreate, callerOf } from "@/lib/api/annotation-schemas";
import type { AnnotationKind } from "@/lib/domain/types";

/** GET /api/tickets/:id/annotations?att=<attId>&open=1 -> Annotation[] in reading order, with replies */
export const GET = route<{ id: string }>((req, r, { id }) => {
  const q = query(req);
  return json(r.annotations.list(id, { attachmentId: q.get("att") ?? undefined, open: q.get("open") === "1" }));
});

/** POST /api/tickets/:id/annotations { attachmentId, page, kind, geometry, quote?, body? } -> Annotation (201); the author follows the caller */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const b = await body(req, annotationCreate);
  return json(r.annotations.create(id, { ...b, kind: b.kind as AnnotationKind, author: callerOf(req) }), { status: 201 });
});
