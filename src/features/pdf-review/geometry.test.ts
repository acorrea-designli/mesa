import { describe, expect, it } from "vitest";
import type { Annotation, AnnotationGeometry, AnnotationKind, PageRect } from "@/lib/domain/types";
import { boundsOf } from "@/lib/domain/annotations";
import { arrowBarbs, clampPt, distToSegment, hitTest, mergeLineRects, rectFromDrag, toPage } from "./geometry";

const mark = (id: string, kind: AnnotationKind, geometry: AnnotationGeometry, page = 1): Annotation => ({
  id,
  ticketId: "tk",
  attachmentId: "at",
  page,
  kind,
  geometry,
  rect: boundsOf(kind, geometry),
  quote: "",
  body: "",
  author: "andres",
  state: "open",
  sentAt: null,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
  replies: [],
});

describe("page units", () => {
  it("is scale independent: the same page point at 1x and 2x", () => {
    expect(toPage(110, 220, { left: 10, top: 20 }, 1)).toEqual({ x: 100, y: 200 });
    expect(toPage(210, 420, { left: 10, top: 20 }, 2)).toEqual({ x: 100, y: 200 });
  });
  it("clamps to the page and orders a drag's corners", () => {
    expect(clampPt({ x: -5, y: 900 }, 600, 800)).toEqual({ x: 0, y: 800 });
    expect(rectFromDrag({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 40, h: 60 });
  });
});

describe("mergeLineRects", () => {
  const r = (x: number, y: number, w: number, h = 12): PageRect => ({ x, y, w, h });
  it("drops tiny and nested boxes and joins a line's spans", () => {
    const out = mergeLineRects([r(10, 100, 80), r(10, 100, 40), r(92, 101, 60), r(0, 0, 0.2), r(10, 120, 50)]);
    expect(out).toEqual([
      { x: 10, y: 100, w: 142, h: 13 },
      { x: 10, y: 120, w: 50, h: 12 },
    ]);
  });
  it("keeps lines apart, and boxes far apart on one line", () => {
    expect(mergeLineRects([r(10, 100, 30), r(200, 100, 30)])).toHaveLength(2);
    expect(mergeLineRects([r(10, 100, 30), r(10, 130, 30)])).toHaveLength(2);
  });
  it("keeps one of two identical boxes", () => {
    expect(mergeLineRects([r(10, 100, 30), r(10, 100, 30)])).toHaveLength(1);
  });
});

describe("hitTest", () => {
  const marks = [
    mark("h", "highlight", { rects: [{ x: 50, y: 100, w: 200, h: 12 }] }),
    mark("big", "rect", { x: 20, y: 20, w: 400, h: 300 }),
    mark("e", "ellipse", { x: 100, y: 400, w: 100, h: 60 }),
    mark("a", "arrow", { x1: 300, y1: 400, x2: 400, y2: 400 }),
    mark("n", "note", { x: 500, y: 500 }),
    mark("p2", "note", { x: 60, y: 600 }, 2),
  ];
  const id = (x: number, y: number, page = 1) => hitTest(marks, page, { x, y }, 5)?.id ?? null;
  it("hits a highlight inside its box and a rectangle only on its stroke", () => {
    expect(id(100, 105)).toBe("h");
    expect(id(100, 200)).toBeNull(); // inside the big rectangle, away from its stroke
    expect(id(20, 200)).toBe("big");
    expect(id(423, 200)).toBe("big"); // 3 units outside, within the tolerance
  });
  it("hits an ellipse on its outline, an arrow near its line and a pin within its disc", () => {
    expect(id(100, 430)).toBe("e");
    expect(id(150, 430)).toBeNull(); // the center of the ellipse
    expect(id(350, 403)).toBe("a");
    expect(id(350, 420)).toBeNull();
    expect(id(503, 497)).toBe("n");
  });
  it("only looks at the page asked, and a pin wins over what is under it", () => {
    expect(id(60, 600, 2)).toBe("p2");
    expect(id(60, 600, 1)).toBeNull();
    const over = [mark("h2", "highlight", { rects: [{ x: 0, y: 0, w: 100, h: 100 }] }), mark("n2", "note", { x: 50, y: 50 })];
    expect(hitTest(over, 1, { x: 52, y: 52 }, 5)?.id).toBe("n2");
  });
});

describe("arrows", () => {
  it("measures a segment distance and draws the barbs behind the tip", () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10);
    const [b1, b2] = arrowBarbs({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(b1.x).toBeLessThan(100);
    expect(b2.x).toBeCloseTo(b1.x);
    expect(b1.y).toBeCloseTo(-b2.y);
  });
});
