import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from ".";

const T0 = new Date("2026-11-09T12:00:00.000Z");
let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
});

const sub = (n: number, over: Partial<{ label: string; userAgent: string }> = {}) => ({
  endpoint: `https://push.example/send/${n}`,
  p256dh: `p256dh-${n}`,
  auth: `auth-${n}`,
  ...over,
});

describe("push subscriptions", () => {
  it("stores a subscription and finds it by endpoint", () => {
    const s = r.push.upsert(sub(1, { label: "Opera", userAgent: "UA" }), T0);
    expect(s).toMatchObject({ endpoint: "https://push.example/send/1", p256dh: "p256dh-1", auth: "auth-1", label: "Opera", userAgent: "UA", createdAt: T0.toISOString(), lastOkAt: null, lastError: null });
    expect(r.push.get("https://push.example/send/1")?.id).toBe(s.id);
    expect(r.push.get("https://push.example/send/2")).toBeNull();
    expect(r.push.count()).toBe(1);
  });

  it("upserts on the endpoint: keys refresh in place and the history is kept", () => {
    const a = r.push.upsert(sub(1), T0);
    r.push.markOk(a.endpoint, T0);
    const b = r.push.upsert({ ...sub(1), p256dh: "rotated", auth: "rotated-auth", label: "Chrome" }, new Date(T0.getTime() + 60_000));
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ p256dh: "rotated", auth: "rotated-auth", label: "Chrome", createdAt: T0.toISOString(), lastOkAt: T0.toISOString() });
    expect(r.push.count()).toBe(1);
  });

  it("removes one subscription and reports whether it existed", () => {
    r.push.upsert(sub(1), T0);
    r.push.upsert(sub(2), T0);
    expect(r.push.remove("https://push.example/send/1")).toBe(true);
    expect(r.push.remove("https://push.example/send/1")).toBe(false);
    expect(r.push.list().map((s) => s.endpoint)).toEqual(["https://push.example/send/2"]);
  });

  it("records the last delivery: ok clears the error, an error is kept short", () => {
    const s = r.push.upsert(sub(1), T0);
    r.push.markError(s.endpoint, "x".repeat(500));
    expect(r.push.get(s.endpoint)?.lastError).toHaveLength(200);
    r.push.markOk(s.endpoint, T0);
    expect(r.push.get(s.endpoint)).toMatchObject({ lastError: null, lastOkAt: T0.toISOString() });
  });
});

describe("push notifier state", () => {
  it("starts empty and round-trips the seen keys and the scan time", () => {
    expect(r.push.seen()).toEqual({});
    expect(r.push.lastScan()).toBeNull();
    r.push.saveScan({ "ticket:1": 5, "salida:s1:v2": 7 }, 1234);
    expect(r.push.seen()).toEqual({ "ticket:1": 5, "salida:s1:v2": 7 });
    expect(r.push.lastScan()).toBe(1234);
    r.push.saveScan({}, 2000);
    expect(r.push.seen()).toEqual({});
    expect(r.push.lastScan()).toBe(2000);
  });

  it("treats a damaged record as empty", () => {
    r.db.prepare("INSERT INTO settings (key, value) VALUES ('push.seen', 'not json'), ('push.last_scan', 'soon')").run();
    expect(r.push.seen()).toEqual({});
    expect(r.push.lastScan()).toBeNull();
  });
});
