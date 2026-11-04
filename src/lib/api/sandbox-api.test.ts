// The sandbox rules at the HTTP boundary: route handlers over an in-memory database, with
// MESA_ENV stubbed per test. Live behaviour must be unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as SYNC } from "@/app/api/github/sync/route";
import { GET as HEALTH } from "@/app/api/health/route";
import { POST as TRANSITION } from "@/app/api/salidas/[id]/transition/route";
import { POST as SWEEP } from "@/app/api/sweep/route";
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

describe("live (default)", () => {
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

  it("says which board answered", async () => {
    expect(await (await HEALTH(req("GET", "/api/health"), ctx())).json()).toMatchObject({ ok: true, env: "sandbox" });
  });
});
