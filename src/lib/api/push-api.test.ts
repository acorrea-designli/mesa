// API tests for /api/push*: subscription upsert, "Probar aviso", the looking beat and the disabled states, with web-push mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/push/route";
import { POST as LOOKING } from "@/app/api/push/looking/route";
import { DELETE, POST as SUBSCRIBE } from "@/app/api/push/subscription/route";
import { POST as TEST } from "@/app/api/push/test/route";
import { openDb } from "../db/sqlite";
import { subscribeChanges, type LiveChange } from "../live/bus";
import { lookingRegistry } from "../push/looking";
import { createRepos, type Repos } from "../repo";

const sendNotification = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("web-push", () => ({ sendNotification: (...a: unknown[]) => sendNotification(...a) }));

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
const ctx = () => ({ params: Promise.resolve({}) });
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://local${path}`, { method, headers: { "content-type": "application/json", "user-agent": "OPR/80 Android" }, body: body === undefined ? undefined : JSON.stringify(body) });
const EP = "https://fcm.googleapis.com/fcm/send/abc";
const sub = { endpoint: EP, keys: { p256dh: "BPk", auth: "aut" }, label: "Opera" };

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  sendNotification.mockReset();
  vi.stubEnv("MESA_VAPID_PUBLIC_KEY", "BPublic-key_1");
  vi.stubEnv("MESA_VAPID_PRIVATE_KEY", "private-key_1");
  vi.stubEnv("MESA_VAPID_SUBJECT", "mailto:a@b.co");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/push", () => {
  it("says the server can send, with the public key only", async () => {
    const body = await (await GET(req("GET", "/api/push"), ctx())).json();
    expect(body).toEqual({ enabled: true, publicKey: "BPublic-key_1", subscriptions: 0 });
  });
  it("says why it cannot without keys", async () => {
    vi.stubEnv("MESA_VAPID_PRIVATE_KEY", "");
    expect(await (await GET(req("GET", "/api/push"), ctx())).json()).toEqual({ enabled: false, reason: "no_keys", subscriptions: 0 });
  });
});

describe("/api/push/subscription", () => {
  it("stores and re-syncs a subscription (upsert, user agent kept)", async () => {
    expect((await SUBSCRIBE(req("POST", "/api/push/subscription", sub), ctx())).status).toBe(200);
    expect((await SUBSCRIBE(req("POST", "/api/push/subscription", { ...sub, keys: { p256dh: "BPk2", auth: "aut2" } }), ctx())).status).toBe(200);
    expect(r.push.list()).toEqual([expect.objectContaining({ endpoint: EP, p256dh: "BPk2", auth: "aut2", label: "Opera", userAgent: "OPR/80 Android" })]);
  });

  it("validates the body: https endpoint, keys present", async () => {
    expect((await SUBSCRIBE(req("POST", "/api/push/subscription", { ...sub, endpoint: "http://insecure.example/x" }), ctx())).status).toBe(400);
    expect((await SUBSCRIBE(req("POST", "/api/push/subscription", { endpoint: EP }), ctx())).status).toBe(400);
    expect(r.push.count()).toBe(0);
  });

  it("is refused (409) while push is off", async () => {
    vi.stubEnv("MESA_VAPID_PUBLIC_KEY", "");
    expect((await SUBSCRIBE(req("POST", "/api/push/subscription", sub), ctx())).status).toBe(409);
    expect(r.push.count()).toBe(0);
  });

  it("DELETE removes this device only", async () => {
    r.push.upsert({ endpoint: EP, p256dh: "k", auth: "a" });
    r.push.upsert({ endpoint: "https://push.example/other", p256dh: "k", auth: "a" });
    const res = await DELETE(req("DELETE", "/api/push/subscription", { endpoint: EP }), ctx());
    expect(await res.json()).toEqual({ ok: true, removed: true });
    expect(r.push.list().map((s) => s.endpoint)).toEqual(["https://push.example/other"]);
  });
});

describe("POST /api/push/test", () => {
  beforeEach(() => void r.push.upsert({ endpoint: EP, p256dh: "k", auth: "a" }));

  it("pushes the test payload to that device", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    expect((await TEST(req("POST", "/api/push/test", { endpoint: EP }), ctx())).status).toBe(200);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sendNotification.mock.calls[0]?.[1] as string);
    expect(payload).toEqual({ title: "Aviso de prueba · Mesa", url: "/telefono", tag: "mesa-test" });
    expect(r.push.get(EP)?.lastOkAt).not.toBeNull();
  });

  it("404 and deletes the subscription when the push service says it is gone", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    expect((await TEST(req("POST", "/api/push/test", { endpoint: EP }), ctx())).status).toBe(404);
    expect(r.push.count()).toBe(0);
  });

  it("502 and keeps the subscription on another refusal", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("server error"), { statusCode: 500 }));
    expect((await TEST(req("POST", "/api/push/test", { endpoint: EP }), ctx())).status).toBe(502);
    expect(r.push.get(EP)?.lastError).toBe("500: server error");
  });

  it("404 for a device that never subscribed, 409 without keys", async () => {
    expect((await TEST(req("POST", "/api/push/test", { endpoint: "https://push.example/nope" }), ctx())).status).toBe(404);
    vi.stubEnv("MESA_VAPID_SUBJECT", "");
    expect((await TEST(req("POST", "/api/push/test", { endpoint: EP }), ctx())).status).toBe(409);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("POST /api/push/looking", () => {
  it("registers a beat without emitting a live frame", async () => {
    const seen: LiveChange[] = [];
    const off = subscribeChanges((c) => seen.push(c));
    lookingRegistry().beat("tab-x", false);
    expect((await LOOKING(req("POST", "/api/push/looking", { tab: "tab-x", looking: true }), ctx())).status).toBe(200);
    expect(lookingRegistry().isLooking()).toBe(true);
    expect((await LOOKING(req("POST", "/api/push/looking", { tab: "tab-x", looking: false }), ctx())).status).toBe(200);
    expect(lookingRegistry().isLooking()).toBe(false);
    expect((await LOOKING(req("POST", "/api/push/looking", { tab: "", looking: true }), ctx())).status).toBe(400);
    off();
    expect(seen).toEqual([]);
  });
});
