import { describe, expect, it } from "vitest";
import type { BandItem } from "./layout";
import { BAND_W, capCenters, layoutBand, layoutCorridor, linePath, lineY, pairUp, solidEnd } from "./layout";

const item = (id: string, source: BandItem["source"], station: BandItem["station"] = "inbox", taskId?: string): BandItem => ({
  id,
  source,
  station,
  taskId,
});

describe("band geometry", () => {
  it("matches the mock at 1256 px", () => {
    expect(capCenters()).toEqual([256, 500, 744, 988, 1200]);
    expect(linePath("github")).toBe("M44 100H460l24 -24H1212");
    expect(linePath("slack")).toBe("M44 124H1212");
    expect(linePath("basecamp")).toBe("M44 172H700l24 24H1212");
  });

  it("keeps bends at 45 degrees when the band scales", () => {
    const w = 900;
    const caps = capCenters(w);
    expect(caps[0]).toBe(44 + (256 - 44) * ((w - 88) / (BAND_W - 88)));
    expect(caps[4]).toBeCloseTo(w - 56, 5);
    const d = linePath("github", w);
    expect(d).toMatch(/l24 -24H856$/);
  });

  it("follows the bend for y", () => {
    expect(lineY("github", 300)).toBe(100);
    expect(lineY("github", 472)).toBe(88);
    expect(lineY("github", 600)).toBe(76);
    expect(lineY("slack", 600)).toBe(124);
  });

  it("cuts the solid overlay just past the selected station", () => {
    expect(solidEnd("inbox")).toBe(300);
    expect(linePath("github", BAND_W, solidEnd("inbox"))).toBe("M44 100H300");
    expect(linePath("github", BAND_W, 470)).toBe("M44 100H460L470 90");
  });
});

describe("tick placement", () => {
  it("puts ticks in the segment before their station, 36 px apart", () => {
    const l = layoutBand([item("a", "github"), item("b", "github"), item("c", "slack", "todo")]);
    const [a, b, c] = l.ticks;
    expect(a).toMatchObject({ id: "a", x: 96, y: 100 });
    expect(b).toMatchObject({ id: "b", x: 132, y: 100 });
    // Todo segment starts after the Inbox capsule (276) + 40; Slack is offset half a step.
    expect(c).toMatchObject({ id: "c", x: 334, y: 124 });
    for (const t of l.ticks) {
      const i = ["inbox", "todo", "doing", "waiting", "done"].indexOf(t.station);
      const caps = capCenters();
      expect(t.x).toBeLessThan((caps[i] ?? 0) - 20);
      if (i > 0) expect(t.x).toBeGreaterThan((caps[i - 1] ?? 0) + 20);
    }
  });

  it("sits GitHub ticks on the raised line after its bend", () => {
    const l = layoutBand([item("a", "github", "doing")]);
    expect(l.ticks[0]).toMatchObject({ y: 76 });
  });

  it("caps a crowded line and shows +N in the last slot", () => {
    const many = Array.from({ length: 9 }, (_, i) => item(`g${i}`, "github"));
    const l = layoutBand(many);
    const ticks = l.ticks.filter((t) => t.source === "github");
    expect(ticks).toHaveLength(3); // room for 4: 3 ticks + the "+N" slot
    expect(l.more).toEqual([{ source: "github", station: "inbox", x: 204, y: 100, n: 6 }]);
  });

  it("does not show +N when everything fits", () => {
    const l = layoutBand(Array.from({ length: 4 }, (_, i) => item(`g${i}`, "github")));
    expect(l.ticks).toHaveLength(4);
    expect(l.more).toHaveLength(0);
  });
});

describe("interchanges", () => {
  it("pairs two sources on one task", () => {
    const { pairs, singles } = pairUp([item("pr", "github", "inbox", "t1"), item("bc", "basecamp", "inbox", "t1"), item("x", "slack")]);
    expect(pairs.map(([a, b]) => [a.id, b.id])).toEqual([["pr", "bc"]]);
    expect(singles.map((s) => s.id)).toEqual(["x"]);
  });

  it("ignores a task with a single source", () => {
    const { pairs } = pairUp([item("a", "github", "inbox", "t1"), item("b", "github", "inbox", "t1")]);
    expect(pairs).toHaveLength(0);
  });

  it("joins the rings with a 45 degree connector near the capsule", () => {
    const l = layoutBand([item("pr", "github", "inbox", "t1"), item("sl", "slack", "inbox", "t1")]);
    expect(l.ticks).toHaveLength(0);
    const [r] = l.rings;
    expect(r?.upper).toEqual({ source: "github", x: 204, y: 100 });
    expect(r?.lower).toEqual({ source: "slack", x: 180, y: 124 });
    expect(Math.abs((r?.upper.x ?? 0) - (r?.lower.x ?? 0))).toBe(Math.abs((r?.upper.y ?? 0) - (r?.lower.y ?? 0)));
  });

  it("keeps ticks clear of a ring on the same line", () => {
    const l = layoutBand([
      item("pr", "github", "inbox", "t1"),
      item("sl", "slack", "inbox", "t1"),
      ...Array.from({ length: 5 }, (_, i) => item(`g${i}`, "github")),
    ]);
    const xs = l.ticks.filter((t) => t.source === "github").map((t) => t.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(204 - 24);
    expect(l.more[0]).toMatchObject({ source: "github", n: 5 - xs.length });
  });
});

describe("phone corridor", () => {
  it("lays ticks along the lines into the selected capsule", () => {
    const c = layoutCorridor([item("a", "github"), item("b", "github"), item("c", "slack")]);
    expect(c.ticks.map((t) => [t.x, t.y])).toEqual([
      [44, 46],
      [76, 46],
      [60, 62],
    ]);
  });

  it("caps at five per line with +N", () => {
    const c = layoutCorridor(Array.from({ length: 8 }, (_, i) => item(`g${i}`, "github")));
    expect(c.ticks).toHaveLength(4);
    expect(c.more[0]).toMatchObject({ n: 4, x: 172 });
  });

  it("draws an interchange at 45 degrees", () => {
    const c = layoutCorridor([item("a", "github", "inbox", "t"), item("b", "slack", "inbox", "t")]);
    expect(c.rings[0]?.upper).toMatchObject({ x: 164, y: 46 });
    expect(c.rings[0]?.lower).toMatchObject({ x: 148, y: 62 });
  });
});

describe("crowded interchanges", () => {
  it("keeps ticks on crossed lines clear of a long connector and stacks a second pair to its left", () => {
    const l = layoutBand([
      item("g1", "github", "inbox", "t1"),
      item("b1", "basecamp", "inbox", "t1"),
      item("g2", "github", "inbox", "t2"),
      item("s2", "slack", "inbox", "t2"),
      ...Array.from({ length: 4 }, (_, i) => item(`c${i}`, "claude")),
    ]);
    const [r1, r2] = l.rings;
    expect(r1?.lower.x).toBe(204 - 72);
    // claude line is crossed at x = 204 - 48 = 156: its ticks stay left of 132.
    for (const t of l.ticks.filter((t) => t.source === "claude")) expect(t.x).toBeLessThanOrEqual(132);
    if (r2) expect(r2.upper.x).toBeLessThan(r1!.lower.x + 72);
  });
});
