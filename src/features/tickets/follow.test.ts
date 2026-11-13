import { describe, expect, it } from "vitest";
import { distanceFromBottom, hasUnseenStep, isNearBottom, NEAR_BOTTOM_PX, nextPlanPill, onNewMessage, pillLabel, planInView, visiblePill } from "./follow";

const box = (scrollTop: number, clientHeight = 500, scrollHeight = 2000) => ({ scrollTop, clientHeight, scrollHeight });

describe("isNearBottom", () => {
  it("is near within 120 px of the end, inclusive", () => {
    expect(NEAR_BOTTOM_PX).toBe(120);
    expect(isNearBottom(box(1500))).toBe(true); // exactly at the end
    expect(isNearBottom(box(1380))).toBe(true); // 120 px away
    expect(isNearBottom(box(1379))).toBe(false); // 121 px away
    expect(isNearBottom(box(0))).toBe(false);
  });
  it("a thread that fits without scrolling is at the bottom", () => {
    expect(isNearBottom(box(0, 600, 400))).toBe(true);
    expect(distanceFromBottom(box(0, 600, 400))).toBe(0);
  });
  it("takes a custom threshold", () => {
    expect(isNearBottom(box(1400), 50)).toBe(false);
    expect(isNearBottom(box(1460), 50)).toBe(true);
  });
});

describe("onNewMessage", () => {
  it("his own message always scrolls", () => {
    expect(onNewMessage({ own: true, wasNearBottom: false })).toBe("scroll");
    expect(onNewMessage({ own: true, wasNearBottom: true })).toBe("scroll");
  });
  it("a message from Claude scrolls only from the bottom, otherwise the pill shows", () => {
    expect(onNewMessage({ own: false, wasNearBottom: true })).toBe("scroll");
    expect(onNewMessage({ own: false, wasNearBottom: false })).toBe("pill");
  });
});

describe("planInView", () => {
  const view = { top: 100, bottom: 600 };
  it("needs 48 px of the plan to show", () => {
    expect(planInView({ top: 200, bottom: 400 }, view)).toBe(true);
    expect(planInView({ top: -300, bottom: 148 }, view)).toBe(true); // 48 px at the top edge
    expect(planInView({ top: -300, bottom: 147 }, view)).toBe(false);
    expect(planInView({ top: 553, bottom: 900 }, view)).toBe(false); // 47 px at the bottom edge
    expect(planInView({ top: 552, bottom: 900 }, view)).toBe(true);
  });
  it("a block shorter than 48 px counts as soon as all of it shows", () => {
    expect(planInView({ top: 300, bottom: 320 }, view)).toBe(true);
    expect(planInView({ top: 700, bottom: 720 }, view)).toBe(false);
  });
});

describe("nextPlanPill", () => {
  const base = { current: null, planned: ["a", "b"], seen: ["a", "b"], inView: false, opening: false } as const;
  it("a planned step the thread had not seen shows 'nuevo' (a plan arrives or grows)", () => {
    expect(nextPlanPill({ ...base, seen: [] })).toBe("nuevo");
    expect(nextPlanPill({ ...base, seen: ["a"] })).toBe("nuevo");
  });
  it("steps already seen show nothing and keep the pill that was up", () => {
    expect(nextPlanPill(base)).toBe(null);
    expect(nextPlanPill({ ...base, current: "nuevo" })).toBe("nuevo");
    expect(nextPlanPill({ ...base, current: "pendiente" })).toBe("pendiente");
  });
  it("opening a ticket whose plan still has planned steps out of view shows 'pendiente'", () => {
    expect(nextPlanPill({ ...base, opening: true })).toBe("pendiente");
    expect(nextPlanPill({ ...base, opening: true, seen: [] })).toBe("pendiente");
  });
  it("the plan in view hides it, on arrival, on opening and when it scrolls in by hand", () => {
    expect(nextPlanPill({ ...base, seen: [], inView: true })).toBe(null);
    expect(nextPlanPill({ ...base, opening: true, inView: true })).toBe(null);
    expect(nextPlanPill({ ...base, current: "nuevo", inView: true })).toBe(null);
  });
  it("no planned steps left hides it, whatever the rest", () => {
    expect(nextPlanPill({ ...base, planned: [], current: "nuevo" })).toBe(null);
    expect(nextPlanPill({ ...base, planned: [], opening: true })).toBe(null);
    expect(nextPlanPill({ ...base, planned: [], seen: [] })).toBe(null);
  });
  it("a plan that grows while 'pendiente' is up turns it into 'nuevo'", () => {
    expect(nextPlanPill({ ...base, current: "pendiente", planned: ["a", "b", "c"] })).toBe("nuevo");
  });
});

describe("hasUnseenStep", () => {
  it("is true only for a planned id outside the seen ones", () => {
    expect(hasUnseenStep(["a"], [])).toBe(true);
    expect(hasUnseenStep(["a"], ["a", "b"])).toBe(false);
    expect(hasUnseenStep([], [])).toBe(false);
  });
});

describe("visiblePill", () => {
  it("the plan pill wins over the message pill, whatever its kind", () => {
    expect(visiblePill({ plan: "nuevo", message: true })).toBe("plan-nuevo");
    expect(visiblePill({ plan: "pendiente", message: true })).toBe("plan-pendiente");
  });
  it("the message pill returns once the plan pill is gone, if still due", () => {
    expect(visiblePill({ plan: null, message: true })).toBe("message");
    expect(visiblePill({ plan: null, message: false })).toBe(null);
  });
});

describe("pillLabel", () => {
  it("every pill points down, never up at a plan that now sits at the bottom", () => {
    expect(pillLabel("plan-nuevo")).toEqual({ text: "Ver plan nuevo", arrow: "↓" });
    expect(pillLabel("plan-pendiente")).toEqual({ text: "Plan pendiente", arrow: "↓" });
    expect(pillLabel("message")).toEqual({ text: "nuevo mensaje", arrow: "↓" });
  });
});
