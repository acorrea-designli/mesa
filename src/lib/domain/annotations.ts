// PDF review marks (t125): geometry in page units, validated per kind, with its bounding box. Pure.
import type { Annotation, AnnotationGeometry, AnnotationKind, PageRect } from "./types";

export const ANNOTATION_KINDS: readonly AnnotationKind[] = ["highlight", "note", "rect", "ellipse", "arrow", "comment"];

/** A page is never bigger than this in PDF points (the PDF spec caps a page at 14 400 units a side). */
export const MAX_COORD = 14_400;
export const MAX_HIGHLIGHT_RECTS = 400;
export const MAX_BODY = 8_000;
export const MAX_QUOTE = 4_000;
/** The page of a general comment that covers the whole document. */
export const WHOLE_DOCUMENT = 0;
/** A general comment (t147): no selection, no shape, no canvas overlay; its page is 0 (the whole document) or a page. */
export const isGeneral = (a: Pick<Annotation, "kind">): boolean => a.kind === "comment";

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_COORD;
const isRect = (v: unknown): v is PageRect => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return num(o.x) && num(o.y) && num(o.w) && num(o.h);
};

/** The geometry of `kind` as stored, or the problem with `raw` (English, for a 400). Extra keys are dropped. */
export function parseGeometry(kind: AnnotationKind, raw: unknown): { ok: true; geometry: AnnotationGeometry } | { ok: false; problem: string } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bad = (problem: string) => ({ ok: false as const, problem });
  switch (kind) {
    case "highlight": {
      const rects = o.rects;
      if (!Array.isArray(rects) || !rects.length) return bad("a highlight needs geometry.rects with at least one {x,y,w,h}");
      if (rects.length > MAX_HIGHLIGHT_RECTS) return bad(`a highlight has at most ${MAX_HIGHLIGHT_RECTS} rects`);
      if (!rects.every(isRect)) return bad("every highlight rect needs numeric x, y, w, h in page units (0 to 14400)");
      return { ok: true, geometry: { rects: rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) } };
    }
    case "note":
      if (!num(o.x) || !num(o.y)) return bad("a note needs geometry {x,y} in page units");
      return { ok: true, geometry: { x: o.x, y: o.y } };
    case "rect":
    case "ellipse":
      if (!isRect(o)) return bad(`a ${kind} needs geometry {x,y,w,h} in page units`);
      if (o.w <= 0 || o.h <= 0) return bad(`a ${kind} needs a width and a height above 0`);
      return { ok: true, geometry: { x: o.x, y: o.y, w: o.w, h: o.h } };
    case "comment":
      return { ok: true, geometry: {} };
    case "arrow":
      if (!num(o.x1) || !num(o.y1) || !num(o.x2) || !num(o.y2)) return bad("an arrow needs geometry {x1,y1,x2,y2} in page units");
      return { ok: true, geometry: { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 } };
  }
}

/** Bounding box of a stored geometry. */
export function boundsOf(kind: AnnotationKind, g: AnnotationGeometry): PageRect {
  if (kind === "highlight" && "rects" in g) {
    const xs = g.rects.flatMap((r) => [r.x, r.x + r.w]);
    const ys = g.rects.flatMap((r) => [r.y, r.y + r.h]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if ("x1" in g) {
    const x = Math.min(g.x1, g.x2);
    const y = Math.min(g.y1, g.y2);
    return { x, y, w: Math.abs(g.x2 - g.x1), h: Math.abs(g.y2 - g.y1) };
  }
  if ("w" in g) return { x: g.x, y: g.y, w: g.w, h: g.h };
  if ("x" in g) return { x: g.x, y: g.y, w: 0, h: 0 };
  return { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * Reading order: page (a whole-document comment is page 0, so first), then the page's general comments before its
 * anchored marks, then top to bottom, then left to right, then oldest first.
 */
export function byPosition(a: Pick<Annotation, "page" | "kind" | "rect" | "createdAt" | "id">, b: Pick<Annotation, "page" | "kind" | "rect" | "createdAt" | "id">): number {
  return a.page - b.page || Number(isGeneral(b)) - Number(isGeneral(a)) || a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Short Spanish label of a mark's kind, for the panel and the CLI's humans. */
export const KIND_LABEL: Record<AnnotationKind, string> = {
  highlight: "Subrayado",
  note: "Comentario",
  rect: "Rectángulo",
  ellipse: "Elipse",
  arrow: "Flecha",
  comment: "Comentario general",
};
