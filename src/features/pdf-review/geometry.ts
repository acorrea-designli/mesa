// PDF review geometry (t125), pure. Everything stored is in page units (the page's viewport at scale 1, origin top
// left); the screen is page units times the current scale. Hit tests and drags work in page units too.
import type { Annotation, AnnotationKind, PageRect } from "@/lib/domain/types";

export interface Pt {
  x: number;
  y: number;
}

/** A client (screen) point to page units, for a page element whose top left is `box` and whose scale is `scale`. */
export const toPage = (clientX: number, clientY: number, box: { left: number; top: number }, scale: number): Pt => ({
  x: (clientX - box.left) / scale,
  y: (clientY - box.top) / scale,
});

export const clampPt = (p: Pt, w: number, h: number): Pt => ({ x: Math.min(Math.max(p.x, 0), w), y: Math.min(Math.max(p.y, 0), h) });

/** The box between two corners (a rectangle or ellipse drag), whichever way it was dragged. */
export function rectFromDrag(a: Pt, b: Pt): PageRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Round to 2 decimals: page units are PDF points, more digits only bloat the stored JSON. */
export const r2 = (n: number) => Math.round(n * 100) / 100;

const contains = (o: PageRect, i: PageRect) => i.x >= o.x - 0.5 && i.y >= o.y - 0.5 && i.x + i.w <= o.x + o.w + 0.5 && i.y + i.h <= o.y + o.h + 0.5;

/**
 * The client rects of a text selection, as one box per line: tiny and nested boxes are dropped (a range reports its
 * spans and their text nodes), boxes on the same line that touch or sit a word apart merge. Page units in, page units out.
 */
export function mergeLineRects(rects: PageRect[], max = 400): PageRect[] {
  const sane = rects.filter((r) => r.w >= 0.5 && r.h >= 0.5);
  const lone = sane.filter((r, i) => !sane.some((o, j) => j !== i && contains(o, r) && (!contains(r, o) || j < i)));
  lone.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PageRect[] = [];
  for (const r of lone) {
    const last = lines.at(-1);
    const overlap = last ? Math.min(last.y + last.h, r.y + r.h) - Math.max(last.y, r.y) : 0;
    if (last && overlap > 0.6 * Math.min(last.h, r.h) && r.x - (last.x + last.w) < Math.max(last.h, r.h) * 0.6) {
      const x = Math.min(last.x, r.x);
      const y = Math.min(last.y, r.y);
      last.w = Math.max(last.x + last.w, r.x + r.w) - x;
      last.h = Math.max(last.y + last.h, r.y + r.h) - y;
      last.x = x;
      last.y = y;
    } else lines.push({ ...r });
  }
  return lines.slice(0, max).map((r) => ({ x: r2(r.x), y: r2(r.y), w: r2(r.w), h: r2(r.h) }));
}

/** Distance from a point to a segment. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const PRIORITY: Record<AnnotationKind, number> = { note: 4, arrow: 3, rect: 2, ellipse: 2, highlight: 1 };

/**
 * The mark under a point on a page (page units), or null. `tol` is the grab distance in page units (a few screen
 * pixels over the scale). A highlight is hit inside its boxes, a pin within its disc, a shape on its stroke only (so
 * the page under a big rectangle stays clickable). The smaller and the later wins among equals.
 */
export function hitTest(marks: Annotation[], page: number, p: Pt, tol: number, pinRadius = tol): Annotation | null {
  let best: { a: Annotation; score: number } | null = null;
  for (const a of marks) {
    if (a.page !== page) continue;
    let hit = false;
    const g = a.geometry;
    if (a.kind === "highlight" && "rects" in g) hit = g.rects.some((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    else if (a.kind === "note" && "x" in g && !("w" in g)) hit = Math.hypot(p.x - g.x, p.y - g.y) <= pinRadius;
    else if (a.kind === "arrow" && "x1" in g) hit = distToSegment(p, { x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }) <= tol;
    else if (a.kind === "rect" && "w" in g) {
      const inner = p.x >= g.x + tol && p.x <= g.x + g.w - tol && p.y >= g.y + tol && p.y <= g.y + g.h - tol;
      hit = p.x >= g.x - tol && p.x <= g.x + g.w + tol && p.y >= g.y - tol && p.y <= g.y + g.h + tol && !inner;
    } else if (a.kind === "ellipse" && "w" in g) {
      const rx = g.w / 2;
      const ry = g.h / 2;
      if (rx > 0 && ry > 0) {
        const d = Math.hypot((p.x - (g.x + rx)) / rx, (p.y - (g.y + ry)) / ry); // 1 on the outline
        hit = Math.abs(d - 1) * Math.min(rx, ry) <= tol;
      }
    }
    if (!hit) continue;
    const score = PRIORITY[a.kind] * 1e9 - a.rect.w * a.rect.h;
    if (!best || score >= best.score) best = { a, score };
  }
  return best?.a ?? null;
}

/** The arrow head's two barbs for a segment, as points (page units): 25 degrees either side, `len` long. */
export function arrowBarbs(a: Pt, b: Pt, len: number): [Pt, Pt] {
  const ang = Math.atan2(a.y - b.y, a.x - b.x);
  const barb = (d: number): Pt => ({ x: b.x + len * Math.cos(ang + d), y: b.y + len * Math.sin(ang + d) });
  const d = (25 * Math.PI) / 180;
  return [barb(d), barb(-d)];
}

/** Smallest drag that makes a shape, in screen pixels: a click is not a drag. */
export const DRAG_MIN_PX = 5;
