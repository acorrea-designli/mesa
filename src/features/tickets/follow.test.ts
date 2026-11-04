import { describe, expect, it } from "vitest";
import { distanceFromBottom, isNearBottom, NEAR_BOTTOM_PX, onNewMessage } from "./follow";

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
