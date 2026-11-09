// The sandbox rules at the HTTP boundary: route handlers over an in-memory database, with
// MESA_ENV stubbed per test. Live behaviour must be unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as SYNC } from "@/app/api/github/sync/route";
import { GET as HEALTH } from "@/app/api/health/route";
import { POST as TRANSITION } from "@/app/api/salidas/[id]/transition/route";
import { POST as PUSH } from "@/app/api/sandbox/push/route";
import { POST as SWEEP } from "@/app/api/sweep/route";
import { POST as TICKET_TRANSITION } from "@/app/api/tickets/[id]/transition/route";
import { POST as BATCH } from "@/app/api/tasks/batch/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
});
afterEach(() => vi.unstubAllEnvs());

const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://local${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** A salida approved 30 s ago: the route's sweep releases it, so `sent` is allowed. */
function released() {
  const s = r.salidas.create({ source: "slack", destination: { kind: "slack_channel", workspace: "designli", channel: "#pruebas", postAs: "Andrés" }, body: "hola" });
  r.salidas.transition(s.id, { type: "approve", version: 1 }, new Date(Date.now() - 30_000));
  return s.id;
}
const send = (id: string, ev: object) => TRANSITION(req("POST", `/api/salidas/${id}/transition`, { type: "sent", ...ev }), ctx({ id }));

/** A closed review ticket on acme/api#7 reviewed at head "old1". */
function closedReview() {
  const t = r.tickets.create({ direction: "andres_asks", title: "Revisa PR 7", ownerSession: "lead" });
  r.reviews.open(t.ref, { repo: "acme/api", pr: 7, sha: "old1" });
  r.tickets.transition(t.ref, { type: "close", by: "claude" });
  return t.ref;
}
const push = (body: object) => PUSH(req("POST", "/api/sandbox/push", body), ctx());

describe("live (default)", () => {
  it("refuses a simulated push and leaves the ticket closed", async () => {
    const ref = closedReview();
    const res = await push({ ref });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_sandbox");
    expect(r.tickets.get(ref).status).toBe("closed");
    expect(r.reviews.list({ ticket: ref })[0]!.seenHead).toBe("");
  });

  it("reopens a closed ticket by hand through the transition route, with a reason", async () => {
    const ref = closedReview();
    const res = await TICKET_TRANSITION(req("POST", `/api/tickets/${ref}/transition`, { event: "reopen", reason: "otra vuelta" }), ctx({ id: ref }));
    expect(res.status).toBe(200);
    expect(r.tickets.get(ref).status).toBe("waiting_claude");
    expect(JSON.parse((r.db.prepare("SELECT payload FROM wake_events WHERE kind = 'ticket.reopened'").get() as { payload: string }).payload)).toMatchObject({ ref, reason: "otra vuelta" });
  });

  it("only Andrés's reopen is an interaction of his: the route passes `by` (a teammate's `by: claude` is not)", async () => {
    const reopen = (ref: string, by?: string) =>
      TICKET_TRANSITION(req("POST", `/api/tickets/${ref}/transition`, { event: "reopen", ...(by ? { by } : {}) }), ctx({ id: ref }));
    const a = closedReview();
    expect((await reopen(a, "claude")).status).toBe(200);
    expect(r.tickets.get(a).status).toBe("waiting_claude");
    expect(r.lastInteractionAt()).toBeNull();

    const b = closedReview();
    await reopen(b); // the UI's Reabrir sends by: andres; a missing `by` is Andrés too
    expect(r.lastInteractionAt()).not.toBeNull();
  });

  it("sends with the real permalink and refuses simulated", async () => {
    const a = released();
    const bad = await send(a, { simulated: true });
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("not_sandbox");
    expect(r.salidas.get(a).status).toBe("sending");
    const ok = await send(a, { permalink: "https://designli.slack.com/archives/C1/p1" });
    expect(ok.status).toBe(200);
    expect(r.salidas.get(a)).toMatchObject({ status: "sent", permalink: "https://designli.slack.com/archives/C1/p1" });
  });

  it("keeps sweep and health as they were", async () => {
    expect((await SWEEP(req("POST", "/api/sweep", {}), ctx())).status).toBe(202);
    expect(await (await HEALTH(req("GET", "/api/health"), ctx())).json()).toMatchObject({ ok: true, env: "live" });
  });
});

describe("sandbox", () => {
  beforeEach(() => vi.stubEnv("MESA_ENV", "sandbox"));

  it("accepts sent only as simulated and records sandbox://<source>/<id>", async () => {
    const a = released();
    const real = await send(a, { permalink: "https://designli.slack.com/archives/C1/p1" });
    expect(real.status).toBe(409);
    expect(((await real.json()) as { error: { code: string } }).error.code).toBe("sandbox");
    expect((await send(a, {})).status).toBe(409);
    expect(r.salidas.get(a).status).toBe("sending");
    const ok = await send(a, { simulated: true });
    expect(ok.status).toBe(200);
    expect(r.salidas.get(a)).toMatchObject({ status: "sent", permalink: `sandbox://slack/${a}` });
  });

  it("keeps the 20 s undo rule: simulated before release is still refused", async () => {
    const s = r.salidas.create({ source: "slack", destination: { kind: "slack_channel", workspace: "designli", channel: "#pruebas", postAs: "Andrés" }, body: "hola" });
    r.salidas.transition(s.id, { type: "approve", version: 1 });
    const res = await send(s.id, { simulated: true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_transition");
  });

  it("refuses GitHub sync and the sweeper wake with 409 sandbox", async () => {
    vi.stubEnv("MESA_GITHUB", "on");
    const sync = await SYNC(req("POST", "/api/github/sync"), ctx());
    expect(sync.status).toBe(409);
    expect(((await sync.json()) as { error: { code: string } }).error.code).toBe("sandbox");
    const sweep = await SWEEP(req("POST", "/api/sweep", {}), ctx());
    expect(sweep.status).toBe(409);
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM wake_events WHERE kind = 'sweep.requested'").get()).toEqual({ n: 0 });
  });

  it("dispatches cards to Claude as on the live board (a ticket per card, one batch wake, nothing outward)", async () => {
    const a = r.tasks.create({ title: "Revisar backups", source: "claude" });
    const b = r.tasks.create({ title: "Responder a Matt", source: "claude" });
    const res = await BATCH(req("POST", "/api/tasks/batch", { action: "dispatch", ids: [a.id, b.id] }), ctx());
    expect(res.status).toBe(200);
    const out = (await res.json()) as { results: { created: boolean; ticket: { id: string } }[] };
    expect(out.results.map((x) => x.created)).toEqual([true, true]);
    const wakes = r.db.prepare("SELECT session_id, kind FROM wake_events ORDER BY id").all();
    // Two new tickets in one call wake the lead once, with ticket.batch.
    expect(wakes).toEqual([{ session_id: "lead", kind: "ticket.batch" }]);
    expect(r.tasks.get(a.id).ticketId).toBe(out.results[0]!.ticket.id);
  });

  it("a simulated push reopens the closed review ticket through the poll's function; the same sha again is a no-op", async () => {
    const ref = closedReview();
    const res = await push({ ref });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { reopened: boolean; oldHead: string; newHead: string; repo: string; pr: number };
    expect(out).toMatchObject({ reopened: true, oldHead: "old1", repo: "acme/api", pr: 7 });
    expect(out.newHead).toMatch(/^[0-9a-f]{40}$/);
    expect(r.tickets.get(ref).status).toBe("waiting_claude");
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM wake_events WHERE kind = 'ticket.reopened'").get()).toEqual({ n: 1 });

    r.tickets.transition(ref, { type: "close", by: "claude" });
    const again = (await (await push({ ref, sha: out.newHead })).json()) as { reopened: boolean };
    expect(again.reopened).toBe(false);
    expect(r.tickets.get(ref).status).toBe("closed");
    const explicit = (await (await push({ ref, sha: "feedbeef" })).json()) as { reopened: boolean; newHead: string };
    expect(explicit).toMatchObject({ reopened: true, newHead: "feedbeef" });
  });

  it("answers 404 for a ticket without a review and 400 without a ref", async () => {
    const t = r.tickets.create({ direction: "andres_asks", title: "sin review" });
    expect((await push({ ref: t.ref })).status).toBe(404);
    expect((await push({})).status).toBe(400);
  });

  it("says which board answered", async () => {
    expect(await (await HEALTH(req("GET", "/api/health"), ctx())).json()).toMatchObject({ ok: true, env: "sandbox" });
  });
});
