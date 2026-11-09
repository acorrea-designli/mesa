import { describe, expect, it } from "vitest";
import { browserLabel, detectBrowser, detectPlatform, guidesFor, installDiagnostics, installStatus, offerKind, recentlyDismissed } from "./install";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const DAY = 86_400_000;
const base = { standalone: false, platform: "other" as const, hasPrompt: false, dismissedRaw: null, now: NOW };
const phone = { ...base, phoneSized: true, waited: true };

const UA = {
  chrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  opera: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 OPR/82.1.0",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  edge: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0",
  firefox: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
};

describe("detectPlatform", () => {
  it("finds iOS, including iPadOS posing as a Mac", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 0)).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile Safari/537.36")).toBe("other");
  });
});

describe("detectBrowser", () => {
  it("tells Opera, Samsung Internet and Edge apart from Chrome, which they all claim to be", () => {
    expect(detectBrowser(UA.opera)).toBe("opera");
    expect(detectBrowser(UA.samsung)).toBe("samsung");
    expect(detectBrowser(UA.edge)).toBe("edge");
    expect(detectBrowser(UA.chrome)).toBe("chrome");
  });
  it("knows Firefox, Safari, Chrome on iOS and an unknown agent", () => {
    expect(detectBrowser(UA.firefox)).toBe("firefox");
    expect(detectBrowser(UA.safari)).toBe("safari");
    expect(detectBrowser(UA.chromeIos)).toBe("chrome");
    expect(detectBrowser("curl/8.0")).toBe("other");
    expect(detectBrowser("")).toBe("other");
  });
  it("has a readable label for each", () => {
    expect(browserLabel("opera")).toBe("Opera");
    expect(browserLabel("samsung")).toBe("Samsung Internet");
  });
});

describe("guidesFor", () => {
  it("gives Opera its own menu steps", () => {
    const [g] = guidesFor("other", "opera", true);
    expect(g?.who).toBe("Opera");
    expect(g?.text).toContain("Añadir a…");
    expect(g?.text).toContain("Pantalla de inicio");
  });
  it("gives Samsung Internet its own steps", () => {
    expect(guidesFor("other", "samsung", true)[0]?.text).toContain("Añadir página a");
  });
  it("gives Chrome and the rest the Android menu steps", () => {
    for (const b of ["chrome", "edge", "firefox", "other"] as const) {
      const guides = guidesFor("other", b, true);
      expect(guides).toHaveLength(1);
      expect(guides[0]?.text).toContain("Instalar app");
      expect(guides[0]?.text).toContain("Agregar a pantalla principal");
    }
  });
  it("gives iOS the Compartir steps whatever the browser", () => {
    const guides = guidesFor("ios", "chrome", true);
    expect(guides).toHaveLength(1);
    expect(guides[0]?.who).toBe("iPhone");
    expect(guides[0]?.text).toContain("Agregar a inicio");
  });
  it("shows every guide on a wide screen (the PC)", () => {
    expect(guidesFor("other", "chrome", false).map((g) => g.who)).toEqual(["Chrome y otros", "Opera", "Samsung Internet", "iPhone"]);
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
  it("offers the manual guide on a phone once the wait passed without the event", () => {
    expect(offerKind(phone)).toBe("manual");
  });
  it("waits for the event first, and keeps quiet on a wide window", () => {
    expect(offerKind({ ...phone, waited: false })).toBeNull();
    expect(offerKind({ ...phone, phoneSized: false })).toBeNull();
  });
  it("switches to the native prompt if the event arrives after the manual guide", () => {
    expect(offerKind({ ...phone, hasPrompt: true })).toBe("prompt");
  });
  it("offers nothing when already installed (standalone)", () => {
    expect(offerKind({ ...phone, hasPrompt: true, standalone: true })).toBeNull();
    expect(offerKind({ ...base, platform: "ios", standalone: true })).toBeNull();
    expect(offerKind({ ...phone, standalone: true })).toBeNull();
  });
  it("offers nothing within 14 days of a dismiss, and again after", () => {
    const recent = new Date(NOW - 3 * DAY).toISOString();
    expect(offerKind({ ...base, hasPrompt: true, dismissedRaw: recent })).toBeNull();
    expect(offerKind({ ...base, platform: "ios", dismissedRaw: recent })).toBeNull();
    expect(offerKind({ ...phone, dismissedRaw: recent })).toBeNull();
    expect(offerKind({ ...phone, dismissedRaw: new Date(NOW - 15 * DAY).toISOString() })).toBe("manual");
    expect(offerKind({ ...base, hasPrompt: true, dismissedRaw: new Date(NOW - 15 * DAY).toISOString() })).toBe("prompt");
  });
  it("offers nothing on a plain desktop browser", () => {
    expect(offerKind(base)).toBeNull();
  });
});

describe("installStatus", () => {
  it("reads installed, prompt, dismissed, ios, manual, waiting and wide", () => {
    expect(installStatus({ ...phone, standalone: true })).toBe("installed");
    expect(installStatus({ ...phone, hasPrompt: true })).toBe("prompt");
    expect(installStatus({ ...phone, dismissedRaw: new Date(NOW - DAY).toISOString() })).toBe("dismissed");
    expect(installStatus({ ...phone, platform: "ios" })).toBe("ios");
    expect(installStatus(phone)).toBe("manual");
    expect(installStatus({ ...phone, waited: false })).toBe("waiting");
    expect(installStatus(base)).toBe("wide");
  });
});

describe("installDiagnostics", () => {
  const rows = (o: object) => Object.fromEntries(installDiagnostics({ ...phone, secure: true, sw: "active", browser: "opera", ...o }).map((r) => [r.key, r.value]));
  it("labels the device facts in Spanish", () => {
    const r = rows({});
    expect(r.standalone).toContain("no");
    expect(r.browser).toBe("Opera");
    expect(r.hasPrompt).toBe("no llegó");
    expect(r.dismissed).toContain("visible");
    expect(r.sw).toBe("activo");
  });
  it("reports a prompt, a dismiss and a missing service worker", () => {
    expect(rows({ hasPrompt: true }).hasPrompt).toBe("disponible");
    expect(rows({ dismissedRaw: new Date(NOW - DAY).toISOString() }).dismissed).toBe("oculto");
    expect(rows({ sw: "none" }).sw).toBe("no registrado");
    expect(rows({ standalone: true }).standalone).toContain("sí");
  });
});
