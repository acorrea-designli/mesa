import { describe, expect, it } from "vitest";
import { detectPlatform, offerKind, recentlyDismissed } from "./install";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const DAY = 86_400_000;
const base = { standalone: false, platform: "other" as const, hasPrompt: false, dismissedRaw: null, now: NOW };

describe("detectPlatform", () => {
  it("finds iOS, including iPadOS posing as a Mac", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 0)).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile Safari/537.36")).toBe("other");
  });
});

describe("recentlyDismissed", () => {
  it("is true for 14 days, then offers again", () => {
    expect(recentlyDismissed(new Date(NOW - 13 * DAY).toISOString(), NOW)).toBe(true);
    expect(recentlyDismissed(new Date(NOW - 14 * DAY).toISOString(), NOW)).toBe(false);
    expect(recentlyDismissed(String(NOW - 2 * DAY), NOW)).toBe(true);
  });
  it("ignores nothing stored and junk", () => {
    expect(recentlyDismissed(null, NOW)).toBe(false);
    expect(recentlyDismissed("", NOW)).toBe(false);
    expect(recentlyDismissed("garbage", NOW)).toBe(false);
  });
  it("a date in the future (clock change) does not hide the banner forever", () => {
    expect(recentlyDismissed(new Date(NOW + 30 * DAY).toISOString(), NOW)).toBe(false);
  });
});

describe("offerKind", () => {
  it("offers the native prompt when the browser has one", () => {
    expect(offerKind({ ...base, hasPrompt: true })).toBe("prompt");
  });
  it("offers the written guide on iOS (no beforeinstallprompt there)", () => {
    expect(offerKind({ ...base, platform: "ios" })).toBe("ios");
  });
  it("offers nothing when already installed (standalone)", () => {
    expect(offerKind({ ...base, hasPrompt: true, standalone: true })).toBeNull();
    expect(offerKind({ ...base, platform: "ios", standalone: true })).toBeNull();
  });
  it("offers nothing within 14 days of a dismiss, and again after", () => {
    const recent = new Date(NOW - 3 * DAY).toISOString();
    expect(offerKind({ ...base, hasPrompt: true, dismissedRaw: recent })).toBeNull();
    expect(offerKind({ ...base, platform: "ios", dismissedRaw: recent })).toBeNull();
    expect(offerKind({ ...base, hasPrompt: true, dismissedRaw: new Date(NOW - 15 * DAY).toISOString() })).toBe("prompt");
  });
  it("offers nothing on a browser that cannot install", () => {
    expect(offerKind(base)).toBeNull();
  });
});
