import { beforeEach, describe, expect, it, vi } from "vitest";
import { LAST_SCAN_FRESH_MS } from "@/features/notify/decide";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { vapidConfig, pushStatus } from "./config";
import { createLooking, LOOKING_TTL_MS } from "./looking";
import { scanOnce, sendTest } from "./notifier";
import { encodePayload, TEST_PAYLOAD } from "./payload";
import { deliver, type Sender, type SendOutcome } from "./send";

const NOW = Date.UTC(2026, 10, 9, 15, 0, 0);
const dest = { kind: "slack_channel", workspace: "designli", channel: "#scout-dev", postAs: "Andrés Correa" } as const;
const SECRET_TITLE = "Cancela el mensaje a Matt sobre la tarifa de Freightmate";

let r: Repos;
let sent: { endpoint: string; body: string }[];
let outcome: (endpoint: string) => SendOutcome;
let sender: Sender;
const looking = { value: false };
const deps = () => ({ repos: r, sender, looking: { isLooking: () => looking.value } });
const payloads = () => sent.map((s) => JSON.parse(s.body) as { title: string; url: string; tag: string });

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, new Date(NOW));
  sent = [];
  looking.value = false;
  outcome = () => ({ ok: true });
  sender = async (sub, body) => {
    sent.push({ endpoint: sub.endpoint, body });
    return outcome(sub.endpoint);
  };
  r.push.upsert({ endpoint: "https://push.example/phone", p256dh: "k", auth: "a" });
});

const ask = (title = SECRET_TITLE, extra: Record<string, unknown> = {}) =>
  r.tickets.create({ direction: "claude_asks", title, body: "texto privado del mensaje", ownerSession: "lead", ...extra }, new Date(NOW));
const propose = (over: Record<string, unknown> = {}) => r.salidas.create({ source: "slack", destination: dest, body: "Confirmed.", title: SECRET_TITLE, ownerSession: "lead", ...over }, new Date(NOW));
/** A baseline scan that has seen what exists, ten seconds before NOW. */
const baseline = async () => {
  await scanOnce(deps(), NOW - 10_000);
  sent.length = 0;
};

describe("config", () => {
  const good = { MESA_VAPID_PUBLIC_KEY: "BPub-key_1", MESA_VAPID_PRIVATE_KEY: "priv-key_1", MESA_VAPID_SUBJECT: "mailto:a@b.co" };
  it("needs all three values", () => {
    expect(vapidConfig(good)).toEqual({ publicKey: "BPub-key_1", privateKey: "priv-key_1", subject: "mailto:a@b.co" });
    expect(vapidConfig({ ...good, MESA_VAPID_PRIVATE_KEY: "" })).toBeNull();
    expect(vapidConfig({ ...good, MESA_VAPID_SUBJECT: "andres" })).toBeNull();
    expect(vapidConfig({})).toBeNull();
  });
  it("reports why push is off and exposes only the public key", () => {
    expect(pushStatus(good)).toEqual({ enabled: true, publicKey: "BPub-key_1" });
    expect(pushStatus({})).toEqual({ enabled: false, reason: "no_keys" });
    expect(pushStatus({ ...good, MESA_ENV: "sandbox" })).toEqual({ enabled: false, reason: "sandbox" });
  });
});

describe("the send selection", () => {
  it("pushes a new ticket once, with a title of kind and ref only", async () => {
    await baseline();
    const t = ask();
    const res = await scanOnce(deps(), NOW);
    expect(res.shown).toBe(1);
    expect(payloads()).toEqual([{ title: `Te espera · ${t.ref}`, url: `/tickets?t=${t.ref}`, tag: `ticket:${t.id}` }]);
    await scanOnce(deps(), NOW + 30_000);
    expect(sent).toHaveLength(1); // each once
  });

  it("labels a ticket with an open review 'Review lista'", async () => {
    await baseline();
    const t = ask();
    r.reviews.open(t.ref, { repo: "designli/scout-api", pr: 42, sha: "abc123" }, new Date(NOW));
    await scanOnce(deps(), NOW);
    expect(payloads()[0]?.title).toBe(`Review lista · ${t.ref}`);
    expect(sent[0]?.body).not.toContain("scout-api");
  });

  it("pushes a salida to sign, by ticket ref or plain 'salida', and again at a new version only", async () => {
    await baseline();
    const t = ask();
    const withTicket = propose({ ticketId: t.id });
    const lone = propose();
    await scanOnce(deps(), NOW);
    expect(payloads().map((p) => p.title).sort()).toEqual([`Por firmar · salida`, `Por firmar · ${t.ref}`, `Te espera · ${t.ref}`].sort());
    expect(payloads().find((p) => p.tag === `salida:${lone.id}:v1`)?.url).toBe(`/salidas?s=${lone.id}`);
    sent.length = 0;

    r.salidas.addVersion(withTicket.id, { body: "Otra versión", author: "claude" }, new Date(NOW));
    await scanOnce(deps(), NOW + 1000);
    expect(payloads().map((p) => p.tag)).toEqual([`salida:${withTicket.id}:v2`]);
  });

  it("never pushes his own version of a salida", async () => {
    await baseline();
    const s = propose();
    r.salidas.addVersion(s.id, { body: "Lo escribí yo", author: "andres" }, new Date(NOW));
    await scanOnce(deps(), NOW);
    expect(sent).toEqual([]);
  });

  it("pushes a pending permission by agent name", async () => {
    await baseline();
    const a = r.approvals.create({ agent: "dev-t9", tool: "Bash", summary: "Bash: rm -rf secrets-of-a-client", ticketRef: null }, new Date(NOW));
    await scanOnce(deps(), NOW);
    expect(payloads()).toEqual([{ title: "Permiso pendiente · dev-t9", url: "/", tag: `approval:${a.id}` }]);
  });

  it("never pushes sample data", async () => {
    await baseline();
    ask("Datos de muestra", { isSample: true });
    propose({ isSample: true });
    await scanOnce(deps(), NOW);
    expect(sent).toEqual([]);
  });

  it("the payload carries no titles, message text or repo names", async () => {
    await baseline();
    const t = ask();
    r.reviews.open(t.ref, { repo: "designli/scout-api", pr: 7, sha: "abc" }, new Date(NOW));
    propose({ ticketId: t.id });
    r.approvals.create({ agent: "dev-t9", tool: "Bash", summary: "Bash: pnpm test freightmate", ticketRef: t.ref }, new Date(NOW));
    await scanOnce(deps(), NOW);
    expect(sent).toHaveLength(3);
    for (const s of sent) {
      expect(Object.keys(JSON.parse(s.body)).sort()).toEqual(["tag", "title", "url"]);
      for (const leak of ["Matt", "Freightmate", "freightmate", "tarifa", "texto privado", "scout-api", "Confirmed", "slack", "#scout-dev"]) expect(s.body).not.toContain(leak);
    }
  });

  it("sends to every subscription", async () => {
    r.push.upsert({ endpoint: "https://push.example/tablet", p256dh: "k2", auth: "a2" });
    await baseline();
    ask();
    await scanOnce(deps(), NOW);
    expect(sent.map((s) => s.endpoint).sort()).toEqual(["https://push.example/phone", "https://push.example/tablet"]);
  });
});

describe("quiet", () => {
  it("while a tab is looking nothing is sent, and what arrived is remembered (no push when it looks away)", async () => {
    await baseline();
    const t = ask();
    looking.value = true;
    const res = await scanOnce(deps(), NOW);
    expect(res).toMatchObject({ quiet: true, shown: 0 });
    expect(sent).toEqual([]);
    expect(r.push.seen()).toHaveProperty(`ticket:${t.id}`);
    looking.value = false;
    await scanOnce(deps(), NOW + 5000);
    expect(sent).toEqual([]);
  });

  it("looking beats live 8 seconds and a tab can clear its own", () => {
    const l = createLooking();
    expect(l.isLooking(NOW)).toBe(false);
    l.beat("a", true, NOW);
    expect(l.isLooking(NOW + LOOKING_TTL_MS - 1)).toBe(true);
    expect(l.isLooking(NOW + LOOKING_TTL_MS)).toBe(false);
    l.beat("a", true, NOW);
    l.beat("b", true, NOW);
    l.beat("a", false, NOW + 1);
    expect(l.isLooking(NOW + 2)).toBe(true); // b still looks
    l.beat("b", false, NOW + 3);
    expect(l.isLooking(NOW + 4)).toBe(false);
  });
});

describe("baseline and restarts", () => {
  it("the first scan ever is a silent baseline", async () => {
    ask();
    propose();
    const res = await scanOnce(deps(), NOW);
    expect(res).toMatchObject({ baseline: true, shown: 0 });
    expect(sent).toEqual([]);
    expect(Object.keys(r.push.seen()).sort()).toEqual(["hoy:ready", expect.stringMatching(/^salida:/), expect.stringMatching(/^ticket:/)]);
  });

  it("a restart within 10 minutes scans normally: what entered meanwhile is news, what was seen does not repeat", async () => {
    const old = ask("Anterior");
    await scanOnce(deps(), NOW); // baseline, records the scan time
    const fresh = ask("Nueva");
    // "restart": a new process reads the persisted state
    const res = await scanOnce({ repos: createRepos(r.db), sender, looking: { isLooking: () => false } }, NOW + LAST_SCAN_FRESH_MS - 1000);
    expect(res.baseline).toBe(false);
    expect(payloads().map((p) => p.tag)).toEqual([`ticket:${fresh.id}`]);
    expect(payloads().map((p) => p.tag)).not.toContain(`ticket:${old.id}`);
  });

  it("a server that was down for longer than 10 minutes does not flood: silent baseline", async () => {
    await scanOnce(deps(), NOW);
    ask();
    ask("Otra");
    propose();
    const res = await scanOnce(deps(), NOW + LAST_SCAN_FRESH_MS + 1000);
    expect(res).toMatchObject({ baseline: true, shown: 0 });
    expect(sent).toEqual([]);
  });

  it("a ticket that leaves Te espera and comes back notifies again (new episode)", async () => {
    await baseline();
    const t = ask();
    await scanOnce(deps(), NOW);
    expect(sent).toHaveLength(1);
    r.tickets.addMessage(t.id, { author: "andres", body: "A" }, new Date(NOW + 1000));
    await scanOnce(deps(), NOW + 2000);
    r.tickets.addMessage(t.id, { author: "claude", body: "¿Y ahora?", ask: true }, new Date(NOW + 3000));
    await scanOnce(deps(), NOW + 4000);
    expect(sent).toHaveLength(2);
  });
});

describe("delivery and cleanup", () => {
  const sub = () => r.push.get("https://push.example/phone")!;

  it("a 404 or 410 deletes the subscription", async () => {
    for (const status of [404, 410]) {
      r.push.upsert({ endpoint: "https://push.example/phone", p256dh: "k", auth: "a" });
      outcome = () => ({ ok: false, status, message: "gone" });
      const res = await deliver(r.push, sender, [sub()], { title: "x", url: "/", tag: "t" });
      expect(res).toEqual({ sent: 0, removed: 1, failed: 0 });
      expect(r.push.get("https://push.example/phone")).toBeNull();
    }
  });

  it("another failure keeps the subscription and records the error; a success records the time", async () => {
    outcome = () => ({ ok: false, status: 500, message: "boom" });
    expect(await deliver(r.push, sender, [sub()], { title: "x", url: "/", tag: "t" })).toEqual({ sent: 0, removed: 0, failed: 1 });
    expect(sub().lastError).toBe("500: boom");
    outcome = () => ({ ok: true });
    expect(await deliver(r.push, sender, [sub()], { title: "x", url: "/", tag: "t" }, new Date(NOW))).toEqual({ sent: 1, removed: 0, failed: 0 });
    expect(sub()).toMatchObject({ lastError: null, lastOkAt: new Date(NOW).toISOString() });
  });

  it("a sender that throws is a failure, not a crash", async () => {
    const boom: Sender = async () => {
      throw new Error("network down");
    };
    expect(await deliver(r.push, boom, [sub()], { title: "x", url: "/", tag: "t" })).toEqual({ sent: 0, removed: 0, failed: 1 });
    expect(sub().lastError).toBe("network down");
  });

  it("one dead device does not stop the others, and a 410 during a scan removes only it", async () => {
    r.push.upsert({ endpoint: "https://push.example/dead", p256dh: "k", auth: "a" });
    outcome = (e) => (e.endsWith("/dead") ? { ok: false, status: 410, message: "gone" } : { ok: true });
    await baseline();
    ask();
    const res = await scanOnce(deps(), NOW);
    expect(res.delivery).toEqual({ sent: 1, removed: 1, failed: 0 });
    expect(r.push.list().map((s) => s.endpoint)).toEqual(["https://push.example/phone"]);
  });

  it("'Probar aviso' pushes the test payload to that device only", async () => {
    r.push.upsert({ endpoint: "https://push.example/other", p256dh: "k", auth: "a" });
    const res = await sendTest(r, sender, "https://push.example/phone");
    expect(res.sent).toBe(1);
    expect(sent).toEqual([{ endpoint: "https://push.example/phone", body: encodePayload(TEST_PAYLOAD) }]);
    expect((await sendTest(r, sender, "https://push.example/unknown")).sent).toBe(0);
  });
});

describe("the web-push sender", () => {
  it("sends with the VAPID details and maps the status code of a refusal", async () => {
    const send = vi.fn<(...a: unknown[]) => Promise<unknown>>();
    vi.resetModules();
    vi.doMock("web-push", () => ({ sendNotification: send }));
    const { webPushSender: fresh } = await import("./send");
    const s = fresh({ publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.co" });
    send.mockResolvedValueOnce({ statusCode: 201 });
    expect(await s({ endpoint: "https://push.example/e", p256dh: "p", auth: "a" }, "{}")).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith({ endpoint: "https://push.example/e", keys: { p256dh: "p", auth: "a" } }, "{}", expect.objectContaining({ vapidDetails: { subject: "mailto:a@b.co", publicKey: "pub", privateKey: "priv" }, urgency: "high" }));
    send.mockRejectedValueOnce(Object.assign(new Error("Received unexpected response code"), { statusCode: 410 }));
    expect(await s({ endpoint: "https://push.example/e", p256dh: "p", auth: "a" }, "{}")).toEqual({ ok: false, status: 410, message: "Received unexpected response code" });
    send.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await s({ endpoint: "https://push.example/e", p256dh: "p", auth: "a" }, "{}")).toEqual({ ok: false, status: null, message: "ECONNRESET" });
    vi.doUnmock("web-push");
  });
});
