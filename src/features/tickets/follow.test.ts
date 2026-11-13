import { describe, expect, it } from "vitest";
import { arrowToward, distanceFromBottom, hasUnseenStep, isNearBottom, NEAR_BOTTOM_PX, nextApprovalPill, nextPlanPill, onNewMessage, pillLabel, planInView, visiblePill } from "./follow";

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

describe("nextApprovalPill", () => {
  const base = { current: false, pending: ["p1"], seen: ["p1"], inView: false, opening: false };
  it("a card that arrives while he is scrolled up shows the pill (its block is off screen)", () => {
    expect(nextApprovalPill({ ...base, seen: [] })).toBe(true);
    expect(nextApprovalPill({ ...base, pending: ["p1", "p2"] })).toBe(true); // a second card
  });
  it("a card that arrives while he reads at the bottom is in view: no pill", () => {
    expect(nextApprovalPill({ ...base, seen: [], inView: true })).toBe(false);
  });
  it("opening with a card too tall to fit shows the pill; one already in view does not", () => {
    expect(nextApprovalPill({ ...base, opening: true, seen: [] })).toBe(true);
    expect(nextApprovalPill({ ...base, opening: true, seen: [], inView: true })).toBe(false);
  });
  it("a seen card keeps the pill that was up and does not bring it back after a tap", () => {
    expect(nextApprovalPill({ ...base, current: true })).toBe(true); // persists while he scrolls elsewhere
    expect(nextApprovalPill(base)).toBe(false); // tapped (current cleared), card seen: stays hidden
  });
  it("scrolling the card into view, or deciding the last one, hides it", () => {
    expect(nextApprovalPill({ ...base, current: true, inView: true })).toBe(false);
    expect(nextApprovalPill({ ...base, current: true, pending: [] })).toBe(false);
    expect(nextApprovalPill({ ...base, pending: [], seen: [], opening: true })).toBe(false);
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
  it("a pending permission wins over the plan and the message pill, and they return once it is gone", () => {
    expect(visiblePill({ approval: true, plan: "nuevo", message: true })).toBe("approval");
    expect(visiblePill({ approval: true, plan: null, message: false })).toBe("approval");
    expect(visiblePill({ approval: false, plan: "pendiente", message: true })).toBe("plan-pendiente");
    expect(visiblePill({ approval: false, plan: null, message: true })).toBe("message");
  });
});

describe("pillLabel", () => {
  it("points up at a block that lies above the view, down at one below, and a message always down", () => {
    const view = { top: 100, bottom: 600 };
    expect(arrowToward({ top: -300, bottom: 100 }, view)).toBe("↑"); // ends at the top edge
    expect(arrowToward({ top: -1800, bottom: -1400 }, view)).toBe("↑");
    expect(arrowToward({ top: -300, bottom: 101 }, view)).toBe("↓"); // still overlaps the edge
    expect(arrowToward({ top: 700, bottom: 900 }, view)).toBe("↓");
    expect(pillLabel("plan-pendiente", "↑")).toEqual({ text: "Plan pendiente", arrow: "↑" });
    expect(pillLabel("plan-nuevo", "↑")).toEqual({ text: "Ver plan nuevo", arrow: "↑" });
    expect(pillLabel("approval", "↑")).toEqual({ text: "Permiso pendiente", arrow: "↑" });
    expect(pillLabel("message", "↑")).toEqual({ text: "nuevo mensaje", arrow: "↓" });
  });
  it("by default every pill points down, where the plan and the cards usually sit", () => {
    expect(pillLabel("plan-nuevo")).toEqual({ text: "Ver plan nuevo", arrow: "↓" });
    expect(pillLabel("plan-pendiente")).toEqual({ text: "Plan pendiente", arrow: "↓" });
    expect(pillLabel("message")).toEqual({ text: "nuevo mensaje", arrow: "↓" });
    expect(pillLabel("approval")).toEqual({ text: "Permiso pendiente", arrow: "↓" });
  });
});
