import { describe, expect, it } from "vitest";
import { boundsOf, byPosition, isGeneral, parseGeometry } from "./annotations";

describe("parseGeometry", () => {
  it("keeps only the keys of the kind", () => {
    expect(parseGeometry("note", { x: 10, y: 20, extra: 1 })).toEqual({ ok: true, geometry: { x: 10, y: 20 } });
    expect(parseGeometry("rect", { x: 1, y: 2, w: 3, h: 4 })).toEqual({ ok: true, geometry: { x: 1, y: 2, w: 3, h: 4 } });
    expect(parseGeometry("arrow", { x1: 1, y1: 2, x2: 3, y2: 4 })).toEqual({ ok: true, geometry: { x1: 1, y1: 2, x2: 3, y2: 4 } });
    expect(parseGeometry("highlight", { rects: [{ x: 1, y: 2, w: 3, h: 4, z: 9 }] })).toEqual({ ok: true, geometry: { rects: [{ x: 1, y: 2, w: 3, h: 4 }] } });
  });

  it("rejects the wrong shape for the kind", () => {
    expect(parseGeometry("highlight", { rects: [] }).ok).toBe(false);
    expect(parseGeometry("highlight", { x: 1, y: 2 }).ok).toBe(false);
    expect(parseGeometry("note", { x: 1 }).ok).toBe(false);
    expect(parseGeometry("rect", { x: 1, y: 2, w: 0, h: 4 }).ok).toBe(false);
    expect(parseGeometry("ellipse", { x: 1, y: 2, w: 3 }).ok).toBe(false);
    expect(parseGeometry("arrow", { x1: 1, y1: 2, x2: 3 }).ok).toBe(false);
    expect(parseGeometry("note", null).ok).toBe(false);
  });

  it("rejects negative, non-finite and absurd coordinates", () => {
    expect(parseGeometry("note", { x: -1, y: 2 }).ok).toBe(false);
    expect(parseGeometry("note", { x: Number.NaN, y: 2 }).ok).toBe(false);
    expect(parseGeometry("note", { x: "3", y: 2 }).ok).toBe(false);
    expect(parseGeometry("note", { x: 20_000, y: 2 }).ok).toBe(false);
  });
});

describe("comment (t147)", () => {
  it("has no geometry: anything sent is dropped, and its box is empty", () => {
    expect(parseGeometry("comment", undefined)).toEqual({ ok: true, geometry: {} });
    expect(parseGeometry("comment", { x: 1, y: 2, rects: [] })).toEqual({ ok: true, geometry: {} });
    expect(boundsOf("comment", {})).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(isGeneral({ kind: "comment" })).toBe(true);
    expect(isGeneral({ kind: "note" })).toBe(false);
  });
});

describe("boundsOf", () => {
  it("is the box around every kind", () => {
    expect(boundsOf("highlight", { rects: [{ x: 10, y: 20, w: 100, h: 12 }, { x: 5, y: 34, w: 40, h: 12 }] })).toEqual({ x: 5, y: 20, w: 105, h: 26 });
    expect(boundsOf("note", { x: 7, y: 9 })).toEqual({ x: 7, y: 9, w: 0, h: 0 });
    expect(boundsOf("rect", { x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(boundsOf("arrow", { x1: 50, y1: 80, x2: 10, y2: 20 })).toEqual({ x: 10, y: 20, w: 40, h: 60 });
  });
});

describe("byPosition", () => {
  it("reads page, then top to bottom, then left to right", () => {
    const m = (id: string, page: number, x: number, y: number) => ({ id, page, kind: "note" as const, rect: { x, y, w: 0, h: 0 }, createdAt: "2026-01-01T00:00:00.000Z" });
    const sorted = [m("d", 2, 0, 0), m("c", 1, 90, 40), m("a", 1, 10, 10), m("b", 1, 80, 10)].sort(byPosition).map((x) => x.id);
    expect(sorted).toEqual(["a", "b", "c", "d"]);
  });

  it("puts the whole-document comments first, then each page's comments before its anchored marks (t147)", () => {
    const m = (id: string, page: number, kind: "note" | "comment", x: number, y: number, createdAt = "2026-01-01T00:00:00.000Z") => ({ id, page, kind, rect: { x, y, w: 0, h: 0 }, createdAt });
    const sorted = [
      m("note1", 1, "note", 0, 0),
      m("p2", 2, "comment", 0, 0),
      m("pin2", 2, "note", 0, 0),
      m("p1", 1, "comment", 0, 0),
      m("doc-late", 0, "comment", 0, 0, "2026-01-02T00:00:00.000Z"),
      m("doc", 0, "comment", 0, 0),
    ].sort(byPosition).map((x) => x.id);
    expect(sorted).toEqual(["doc", "doc-late", "p1", "note1", "p2", "pin2"]);
  });
});
