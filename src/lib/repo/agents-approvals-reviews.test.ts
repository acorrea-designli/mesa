import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { TransitionError } from "../db/util";
import { UNDO_WINDOW_MS } from "../domain/salida-machine";
import { eventsAfter } from "../wake/wake";
import { createRepos, type Repos } from "./index";

let r: Repos;
const T0 = new Date("2026-11-03T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
let ref: string;

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
  ref = r.tickets.create({ direction: "andres_asks", title: "Revisa el PR 59", ownerSession: "lead", project: "scout" }, T0).ref;
});

describe("briefs, handoffs, team, context", () => {
  it("brief merges fields and bumps the revision", () => {
    r.agents.putBrief(ref, { goal: "Ship the fix", openQuestions: ["¿staging o prod?"], updatedBy: "dev-t1" }, T0);
    const b = r.agents.putBrief(ref, { nextAction: "open PR", updatedBy: "dev-t1" }, at(1));
    expect(b).toMatchObject({ goal: "Ship the fix", nextAction: "open PR", openQuestions: ["¿staging o prod?"], revision: 2 });
  });

  it("agent names are never reused, even after retirement", () => {
    r.agents.addAgent({ ticket: ref, name: "dev-t1", role: "dev", owner: true }, T0);
    expect(r.agents.retireAgent("dev-t1", at(5)).status).toBe("retired");
    expect(() => r.agents.addAgent({ ticket: ref, name: "dev-t1", role: "dev" })).toThrow(TransitionError);
    expect(r.agents.team({ status: "live" })).toEqual([]);
  });

  it("context returns the resume payload with the latest handoff per agent", () => {
    r.agents.addAgent({ ticket: ref, name: "dev-t1", role: "dev" }, T0);
    r.agents.addHandoff(ref, { agent: "dev-t1", status: "paused", body: "half way" }, at(1));
    r.agents.addHandoff(ref, { agent: "dev-t1", status: "done", body: "done", artifacts: { branch: "fix/x", pr: "#59" } }, at(2));
    r.agents.addHandoff(ref, { agent: "review-t1", status: "blocked", body: "needs creds" }, at(3));
    for (let i = 0; i < 25; i++) r.tickets.addMessage(ref, { author: i % 2 ? "andres" : "claude", body: `m${i}` }, at(10 + i));
    const c = r.agents.context(ref, 20);
    expect(c.messages).toHaveLength(20);
    expect(c.messages.at(-1)?.body).toBe("m24");
    expect(c.handoffs.map((h) => [h.agent, h.status])).toEqual([
      ["review-t1", "blocked"],
      ["dev-t1", "done"],
    ]);
    expect(c.latestHandoff?.agent).toBe("review-t1");
    expect(c.handoffs[1]?.role).toBe("dev");
    expect(c.engram.topicKey).toBe(`mesa/${ref}`);
    expect(c.team.map((a) => a.name)).toEqual(["dev-t1"]);
  });
});

describe("approvals", () => {
  it("allow only before expiry; decisions are final", async () => {
    // wait() runs on the real clock
    const now = new Date();
    const a = r.approvals.create({ ticketRef: ref, agent: "dev-t1", tool: "Bash", summary: "git push", expiresAt: new Date(now.getTime() + 60_000).toISOString() }, now);
    const waiting = r.approvals.wait(a.id, 1000);
    r.approvals.decide(a.id, { decision: "allow", actor: "andres" });
    expect((await waiting).decision).toBe("allow");
    expect(() => r.approvals.decide(a.id, { decision: "deny", actor: "andres" })).toThrow(/already decided/);
  });

  it("expires and refuses a late allow", () => {
    const a = r.approvals.create({ agent: "dev-t1", tool: "Edit", summary: "x.ts", expiresAt: at(1000).toISOString() }, T0);
    expect(r.approvals.get(a.id, at(1000)).status).toBe("expired");
    expect(() => r.approvals.decide(a.id, { decision: "allow", actor: "andres" }, at(1001))).toThrow(/expired/);
    expect(r.approvals.list({ hoy: true }, at(2000)).map((x) => x.id)).toEqual([a.id]);
  });
});

describe("reviews", () => {
  beforeEach(() => {
    r.reviews.upsertFinding(ref, { repo: "acme/scout", pr: 59, label: "blocker", at: "src/a.ts:42", summary: "Null deref", sha: "abc" }, T0);
    r.reviews.upsertFinding(ref, { repo: "acme/scout", pr: 59, label: "nit", summary: "Naming", sha: "abc" }, T0);
  });

  it("numbers findings and upserts by n", () => {
    const f = r.reviews.upsertFinding(ref, { repo: "acme/scout", pr: 59, n: 1, label: "blocker", at: "src/a.ts:42", summary: "Null deref", explanation: "x can be null" });
    expect(f).toMatchObject({ n: 1, explanation: "x can be null" });
    expect(r.reviews.findings(ref).map((x) => x.n)).toEqual([1, 2]);
  });

  it("approve refuses open blockers; approve anyway waives and creates an approved github salida", () => {
    const rev = r.reviews.byPr("acme/scout", 59);
    expect(() => r.reviews.action(rev.id, { action: "approve" }, T0)).toThrow(/blockers/);
    const out = r.reviews.action(rev.id, { action: "approve_anyway" }, T0);
    expect(out.state).toBe("approving");
    expect(out.findings.every((f) => f.state === "waived")).toBe(true);
    const s = r.salidas.get(out.salidaIds[0]!);
    expect(s).toMatchObject({ status: "sending", source: "github", destination: { kind: "github_review", event: "APPROVE", commitId: "abc" } });
    const wake = eventsAfter(r.db, "lead", 0).find((e) => e.kind === "review.action");
    expect(wake?.payload).toMatchObject({ action: "approve_anyway", repo: "acme/scout", pr: 59, findingNs: [1, 2] });
  });

  it("post creates one comment salida per finding with its exact text; undo returns the review to open", () => {
    const rev = r.reviews.byPr("acme/scout", 59);
    const out = r.reviews.action(rev.id, { action: "post", findingNs: [1] }, T0);
    const s = r.salidas.detail(out.salidaIds[0]!);
    expect(s.destination).toMatchObject({ kind: "github_comment", path: "src/a.ts", line: 42, findingN: 1 });
    expect(s.versions[0]?.body).toBe("Null deref");
    expect(() => r.reviews.action(rev.id, { action: "post", findingNs: [1] }, T0)).toThrow(/already posted/);

    r.reviews.action(rev.id, { action: "dismiss", findingNs: [1] }, T0);
    const ap = r.reviews.action(rev.id, { action: "approve" }, T0);
    r.salidas.transition(ap.salidaIds[0]!, { type: "undo" }, at(1000));
    expect(r.reviews.get(rev.id).state).toBe("open");
  });
});

describe("source outages", () => {
  it("approving during a Slack outage queues; recovery releases it with a re-check", () => {
    r.health.set("slack", "down", "MCP unreachable", T0);
    const s = r.salidas.create(
      { source: "slack", destination: { kind: "slack_thread", workspace: "Designli", channel: "#scout-dev", postAs: "Andrés" }, body: "ok", ownerSession: "lead" },
      T0,
    );
    expect(r.salidas.transition(s.id, { type: "approve", version: 1 }, at(1)).status).toBe("queued_until_back");
    r.salidas.sweep(at(UNDO_WINDOW_MS * 2));
    expect(r.salidas.get(s.id).status).toBe("queued_until_back");
    const { resumed } = r.health.set("slack", "ok", "", at(UNDO_WINDOW_MS * 3));
    expect(resumed).toEqual([s.id]);
    expect(r.salidas.get(s.id)).toMatchObject({ status: "sending" });
    const rel = eventsAfter(r.db, "lead", 0).filter((e) => e.kind === "salida.released");
    expect(rel.at(-1)?.payload).toMatchObject({ recheckThread: true, version: 1 });
  });

  it("Barrer ahora wakes the lead", () => {
    r.requestSweep(["slack"], T0);
    expect(eventsAfter(r.db, "lead", 0).at(-1)).toMatchObject({ kind: "sweep.requested", sessionId: "lead", payload: { sources: ["slack"] } });
  });
});
