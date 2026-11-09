// Slack send modes at the HTTP boundary: the mode travels with the approval, the release wake and the salida;
// `drafted` and Andrés's "Ya lo envié" (confirm_sent) move a draft-mode salida to draft_created and then sent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as SHOW } from "@/app/api/salidas/[id]/route";
import { POST as TRANSITION } from "@/app/api/salidas/[id]/transition/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
});
afterEach(() => vi.unstubAllEnvs());

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, ev: object) =>
  TRANSITION(new Request(`http://local/api/salidas/${id}/transition`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ev) }), ctx(id));
const show = async (id: string) => (await (await SHOW(new Request(`http://local/api/salidas/${id}`), ctx(id))).json()) as { status: string; sendMode: string | null; draftedAt: string | null; permalink: string | null };
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

const slackDest = { kind: "slack_thread" as const, workspace: "designli", channel: "#scout-dev", channelId: "C0123ABCD", threadTs: "1730640660.118000", postAs: "Andrés Correa" };
const bcDest = { kind: "basecamp_comment" as const, project: "Scout", postAs: "Andrés" };
const slack = (isSample = false) => r.salidas.create({ source: "slack", destination: slackDest, body: "Confirmado.", ownerSession: "lead", isSample });

/** Approved 30 s ago with `mode`: the route's sweep releases it. */
function released(mode?: "draft" | "send", isSample = false) {
  const s = slack(isSample);
  r.salidas.transition(s.id, { type: "approve", version: 1, mode }, new Date(Date.now() - 30_000));
  return s.id;
}
const releasedWake = () =>
  (r.db.prepare("SELECT payload FROM wake_events WHERE kind = 'salida.released' ORDER BY id DESC").all() as { payload: string }[]).map((w) => JSON.parse(w.payload) as Record<string, unknown>);

describe("the mode is stored with the approval", () => {
  it("defaults to draft, takes send, and is null on a Basecamp salida", async () => {
    const a = slack();
    expect((await post(a.id, { type: "approve", version: 1 })).status).toBe(200);
    expect((await show(a.id)).sendMode).toBe("draft");
    const b = slack();
    expect((await post(b.id, { type: "approve", version: 1, mode: "send" })).status).toBe(200);
    expect((await show(b.id)).sendMode).toBe("send");
    const c = r.salidas.create({ source: "basecamp", destination: bcDest, body: "ok" });
    expect((await post(c.id, { type: "approve", version: 1 })).status).toBe(200);
    expect((await show(c.id)).sendMode).toBeNull();
  });

  it("refuses a mode on a non-Slack salida (409) and an unknown mode (400)", async () => {
    const c = r.salidas.create({ source: "basecamp", destination: bcDest, body: "ok" });
    const res = await post(c.id, { type: "approve", version: 1, mode: "draft" });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).message).toMatch(/only a Slack salida/);
    expect(r.salidas.get(c.id).status).toBe("pending");
    expect((await post(slack().id, { type: "approve", version: 1, mode: "carrier-pigeon" })).status).toBe(400);
  });

  it("an undo clears it, so the next approval can pick the other mode", async () => {
    const a = slack();
    await post(a.id, { type: "approve", version: 1, mode: "send" });
    expect((await post(a.id, { type: "undo" })).status).toBe(200);
    expect((await show(a.id)).sendMode).toBeNull();
    await post(a.id, { type: "approve", version: 1 });
    expect((await show(a.id)).sendMode).toBe("draft");
  });

  it("Programar on a Slack salida records a mode (default draft)", async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const a = slack();
    expect((await post(a.id, { type: "schedule", at, version: 1 })).status).toBe(200);
    expect((await show(a.id)).sendMode).toBe("draft");
  });

  it("travels in the salida.released event and in the salida the CLI shows", async () => {
    const a = released("draft");
    const b = released("send");
    await show(a); // any route call sweeps: both salidas are released now
    expect(r.salidas.get(a)).toMatchObject({ status: "sending", sendMode: "draft" });
    expect(releasedWake().map((p) => p.mode).sort()).toEqual(["draft", "send"]);
    expect(await show(b)).toMatchObject({ status: "sending", sendMode: "send" });
  });
});

describe("drafted and Ya lo envié", () => {
  it("drafted moves a released draft-mode salida to draft_created: not sent, no permalink", async () => {
    const a = released("draft");
    const res = await post(a, { type: "drafted" });
    expect(res.status).toBe(200);
    const s = await show(a);
    expect(s).toMatchObject({ status: "draft_created", sendMode: "draft", permalink: null });
    expect(s.draftedAt).not.toBeNull();
    expect((r.db.prepare("SELECT sent_at FROM salidas WHERE id = ?").get(a) as { sent_at: string | null }).sent_at).toBeNull();
  });

  it("drafted is refused for a send-mode salida, before release, and twice", async () => {
    const sendMode = released("send");
    expect((await post(sendMode, { type: "drafted" })).status).toBe(409);
    const early = slack();
    r.salidas.transition(early.id, { type: "approve", version: 1 });
    expect((await post(early.id, { type: "drafted" })).status).toBe(409);
    const a = released("draft");
    expect((await post(a, { type: "drafted" })).status).toBe(200);
    expect((await post(a, { type: "drafted" })).status).toBe(409);
  });

  it("a sample salida can never be drafted", async () => {
    const a = released("draft", true);
    const res = await post(a, { type: "drafted" });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).message).toMatch(/sample data/);
  });

  it("confirm_sent (Andrés's Ya lo envié) closes it as sent; a send-mode salida has no such button", async () => {
    const a = released("draft");
    await post(a, { type: "drafted" });
    expect((await post(a, { type: "confirm_sent" })).status).toBe(200);
    const s = await show(a);
    expect(s.status).toBe("sent");
    expect((r.db.prepare("SELECT sent_at FROM salidas WHERE id = ?").get(a) as { sent_at: string | null }).sent_at).not.toBeNull();
    expect((await post(released("send"), { type: "confirm_sent" })).status).toBe(409);
    expect((await post(a, { type: "confirm_sent" })).status).toBe(409);
  });

  it("Ya lo envié counts as Andrés's interaction; the lead's drafted does not", async () => {
    const a = released("draft"); // the approval itself is Andrés's click
    r.db.prepare("DELETE FROM settings WHERE key = 'last_interaction_at'").run();
    await post(a, { type: "drafted" });
    expect(r.lastInteractionAt()).toBeNull();
    await post(a, { type: "confirm_sent" });
    expect(r.lastInteractionAt()).not.toBeNull();
  });

  it("a draft_created salida never re-releases and the sweep leaves it alone", async () => {
    const a = released("draft");
    await post(a, { type: "drafted" });
    expect(r.salidas.sweep(new Date(Date.now() + 86_400_000))).toEqual([]);
    expect((await post(a, { type: "release" })).status).toBe(400); // not an API event
    expect(r.salidas.get(a).status).toBe("draft_created");
  });
});

describe("sandbox: drafted goes through the simulated path", () => {
  beforeEach(() => vi.stubEnv("MESA_ENV", "sandbox"));

  it("refuses a real drafted and records sandbox://slack/<id> for a simulated one", async () => {
    const a = released("draft");
    const real = await post(a, { type: "drafted" });
    expect(real.status).toBe(409);
    expect((await errorOf(real)).code).toBe("sandbox");
    expect(r.salidas.get(a).status).toBe("sending");
    expect((await post(a, { type: "drafted", simulated: true })).status).toBe(200);
    expect(await show(a)).toMatchObject({ status: "draft_created", permalink: `sandbox://slack/${a}` });
    expect((await post(a, { type: "confirm_sent" })).status).toBe(200);
  });
});

describe("live: simulated drafts do not exist", () => {
  it("refuses simulated with not_sandbox", async () => {
    const a = released("draft");
    const res = await post(a, { type: "drafted", simulated: true });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("not_sandbox");
    expect(r.salidas.get(a).status).toBe("sending");
  });
});
