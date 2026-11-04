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

  it("post batches the chosen findings into ONE review salida; undo returns the review to open", () => {
    const rev = r.reviews.byPr("acme/scout", 59);
    const out = r.reviews.action(rev.id, { action: "post", findingNs: [1, 2] }, T0);
    expect(out.salidaIds).toHaveLength(1);
    const s = r.salidas.detail(out.salidaIds[0]!);
    expect(s.destination).toMatchObject({
      kind: "github_review",
      event: "REQUEST_CHANGES", // mixed: a blocker among the posted findings
      comments: [
        { path: "src/a.ts", line: 42, body: "Null deref", findingN: 1 },
        { body: "Naming", findingN: 2 },
      ],
    });
    expect(s.title).toMatch(/^Pedir cambios acme\/scout#59/);
    expect(s.versions[0]?.body).toBe("");
    expect(() => r.reviews.action(rev.id, { action: "post", findingNs: [1] }, T0)).toThrow(/already posted/);

    r.reviews.action(rev.id, { action: "dismiss", findingNs: [1] }, T0);
    const ap = r.reviews.action(rev.id, { action: "approve" }, T0);
    r.salidas.transition(ap.salidaIds[0]!, { type: "undo" }, at(1000));
    expect(r.reviews.get(rev.id).state).toBe("open");
  });

  it("post asks for changes only when a posted finding is a blocker", () => {
    const rev = r.reviews.byPr("acme/scout", 59);
    const post = (ns: number[]) => {
      const out = r.reviews.action(rev.id, { action: "post", findingNs: ns }, T0);
      return r.salidas.detail(out.salidaIds[0]!);
    };
    r.reviews.upsertFinding(ref, { repo: "acme/scout", pr: 59, label: "comment", summary: "Consider a helper", sha: "abc" }, T0); // n = 3
    // nits and comments only -> COMMENT
    const soft = post([2, 3]);
    expect(soft.destination).toMatchObject({ event: "COMMENT" });
    expect(soft.title).toMatch(/^Revisión acme\/scout#59/);
    // a blocker alone -> REQUEST_CHANGES
    const hard = post([1]);
    expect(hard.destination).toMatchObject({ event: "REQUEST_CHANGES" });
    expect(hard.title).toMatch(/^Pedir cambios acme\/scout#59 · 1 comentario/);
  });

  it("approve paths keep their APPROVE event", () => {
    const rev = r.reviews.byPr("acme/scout", 59);
    const out = r.reviews.action(rev.id, { action: "approve_anyway" }, T0);
    expect(r.salidas.detail(out.salidaIds[0]!).destination).toMatchObject({ event: "APPROVE" });
  });
});

describe("reviews without findings (review open)", () => {
  const PR = { repo: "acme/scout", pr: 60 };

  it("opens the review card with no findings, requires the head sha, and is idempotent", () => {
    expect(() => r.reviews.open(ref, { ...PR, sha: "" }, T0)).toThrow(/head sha/);
    expect(r.reviews.list({ ticket: ref })).toEqual([]);

    const rev = r.reviews.open(ref, { ...PR, sha: "abc1234" }, T0);
    expect(rev).toMatchObject({ repo: "acme/scout", pr: 60, headSha: "abc1234", state: "open", findings: [] });
    expect(r.reviews.list({ ticket: ref })).toHaveLength(1);

    const again = r.reviews.open(ref, { ...PR, sha: "abc1234" }, at(1000));
    expect(again.id).toBe(rev.id);
    expect(again).toMatchObject({ state: "open", headSha: "abc1234", findings: [] });
    expect(r.reviews.list({ ticket: ref })).toHaveLength(1);
  });

  it("approve on a zero-finding review creates the APPROVE salida pinned to the head sha", () => {
    const rev = r.reviews.open(ref, { ...PR, sha: "abc1234" }, T0);
    const out = r.reviews.action(rev.id, { action: "approve" }, T0);
    expect(out.state).toBe("approving");
    expect(r.salidas.get(out.salidaIds[0]!)).toMatchObject({
      status: "sending",
      source: "github",
      destination: { kind: "github_review", repo: "acme/scout", pr: 60, event: "APPROVE", commitId: "abc1234" },
    });
  });

  it("an approved review reopens at a new head, keeps its findings, and stays approved at the same head", () => {
    r.reviews.upsertFinding(ref, { ...PR, label: "nit", summary: "Naming", sha: "abc1234", state: "waived" }, T0);
    const rev = r.reviews.open(ref, { ...PR, sha: "abc1234" }, T0);
    const out = r.reviews.action(rev.id, { action: "approve" }, T0);
    r.salidas.sweep(at(UNDO_WINDOW_MS));
    r.salidas.transition(out.salidaIds[0]!, { type: "sent", permalink: "https://github.com/acme/scout/pull/60#pullrequestreview-1" }, at(UNDO_WINDOW_MS + 1));
    expect(r.reviews.get(rev.id).state).toBe("approved");

    expect(r.reviews.open(ref, { ...PR, sha: "abc1234" }, at(UNDO_WINDOW_MS + 2)).state).toBe("approved");

    const reopened = r.reviews.open(ref, { ...PR, sha: "def5678" }, at(UNDO_WINDOW_MS + 3));
    expect(reopened).toMatchObject({ id: rev.id, state: "open", headSha: "def5678", salidaId: null });
    expect(reopened.findings).toMatchObject([{ n: 1, state: "waived" }]);

    const second = r.reviews.action(rev.id, { action: "approve" }, at(UNDO_WINDOW_MS + 4));
    expect(r.salidas.get(second.salidaIds[0]!)).toMatchObject({ destination: { commitId: "def5678" } });
  });

  const approveAt = (sha: string) => {
    const rev = r.reviews.open(ref, { ...PR, sha }, T0);
    const out = r.reviews.action(rev.id, { action: "approve" }, T0);
    r.salidas.sweep(at(UNDO_WINDOW_MS));
    r.salidas.transition(out.salidaIds[0]!, { type: "sent", permalink: "https://github.com/acme/scout/pull/60#pullrequestreview-1" }, at(UNDO_WINDOW_MS + 1));
    return rev.id;
  };

  it("a finding upsert never moves the head nor reopens an approved review", () => {
    const id = approveAt("abc1234");
    r.reviews.upsertFinding(ref, { ...PR, label: "nit", summary: "Older commit", sha: "0ld0000" }, at(UNDO_WINDOW_MS + 2));
    expect(r.reviews.get(id)).toMatchObject({ state: "approved", headSha: "abc1234" });
    // it still seeds the head of a row created without one
    r.reviews.upsertFinding(ref, { repo: "acme/scout", pr: 61, label: "nit", summary: "First", sha: "fff9999" }, T0);
    r.reviews.upsertFinding(ref, { repo: "acme/scout", pr: 61, label: "nit", summary: "Second", sha: "eee8888" }, T0);
    expect(r.reviews.byPr("acme/scout", 61).headSha).toBe("fff9999");
  });

  it("open attaches the review to the ticket it names; a finding upsert without a ticket keeps it", () => {
    const next = r.tickets.create({ direction: "andres_asks", title: "Revisa el push del PR 60", ownerSession: "lead", project: "scout" }, T0).ref;
    const rev = r.reviews.open(ref, { ...PR, sha: "abc1234" }, T0);
    expect(rev.ticketId).toBe(r.tickets.get(ref).id);
    const moved = r.reviews.open(next, { ...PR, sha: "def5678" }, at(1000));
    expect(moved).toMatchObject({ id: rev.id, ticketId: r.tickets.get(next).id });
    expect(r.reviews.list({ ticket: ref })).toEqual([]);
    expect(r.reviews.list({ ticket: next })).toHaveLength(1);
    r.reviews.upsertFinding(null, { ...PR, label: "nit", summary: "Naming" }, at(2000));
    expect(r.reviews.get(rev.id).ticketId).toBe(r.tickets.get(next).id);
  });

  it("a new head while approving: once the salida is sent the review is open again, not approved", () => {
    const rev = r.reviews.open(ref, { ...PR, sha: "abc1234" }, T0);
    const out = r.reviews.action(rev.id, { action: "approve" }, T0);
    const during = r.reviews.open(ref, { ...PR, sha: "def5678" }, at(1000));
    expect(during).toMatchObject({ state: "approving", headSha: "def5678" });
    r.salidas.sweep(at(UNDO_WINDOW_MS));
    r.salidas.transition(out.salidaIds[0]!, { type: "sent", permalink: "https://github.com/acme/scout/pull/60#pullrequestreview-1" }, at(UNDO_WINDOW_MS + 1));
    expect(r.reviews.get(rev.id)).toMatchObject({ state: "open", headSha: "def5678", salidaId: null });
  });
});

describe("source outages", () => {
  it("approving during a Slack outage queues; recovery releases it with a re-check", () => {
    r.sources.set("slack", { health: "down", note: "MCP unreachable" }, T0);
    const s = r.salidas.create(
      { source: "slack", destination: { kind: "slack_thread", workspace: "Designli", channel: "#scout-dev", postAs: "Andrés" }, body: "ok", ownerSession: "lead" },
      T0,
    );
    expect(r.salidas.transition(s.id, { type: "approve", version: 1 }, at(1)).status).toBe("queued_until_back");
    r.salidas.sweep(at(UNDO_WINDOW_MS * 2));
    expect(r.salidas.get(s.id).status).toBe("queued_until_back");
    const { resumed } = r.sources.set("slack", { health: "ok" }, at(UNDO_WINDOW_MS * 3));
    expect(resumed).toEqual([s.id]);
    expect(r.salidas.get(s.id)).toMatchObject({ status: "sending" });
    const rel = eventsAfter(r.db, "lead", 0).filter((e) => e.kind === "salida.released");
    expect(rel.at(-1)?.payload).toMatchObject({ recheckThread: true, version: 1 });
  });

  it("keeps sweep watermarks per source", () => {
    expect(r.sources.get("basecamp")).toMatchObject({ health: "ok", watermark: null, cadenceS: 60, errorCount: 0, lastError: null });
    r.sources.set("basecamp", { watermark: "2026-11-03T09:59:00Z", lastChecked: T0.toISOString(), cadenceS: 120, backoffUntil: at(120_000).toISOString() }, T0);
    r.sources.set("basecamp", { health: "degraded", errorCount: 2, lastError: "429 Too Many Requests" }, at(1));
    expect(r.sources.get("basecamp")).toMatchObject({ health: "degraded", watermark: "2026-11-03T09:59:00Z", cadenceS: 120, errorCount: 2, lastError: "429 Too Many Requests" });
  });

  it("Barrer ahora wakes the sweeper and counts as interaction", () => {
    expect(r.lastInteractionAt()).toBeNull();
    r.requestSweep(["slack"], T0);
    expect(eventsAfter(r.db, "sweeper", 0).at(-1)).toMatchObject({ kind: "sweep.requested", sessionId: "sweeper", payload: { sources: ["slack"] } });
    expect(r.lastInteractionAt()).toBe(T0.toISOString());
  });

  it("Andrés acting in the UI stamps lastInteractionAt; Claude does not", () => {
    r.tickets.addMessage(ref, { author: "claude", body: "q" }, at(5));
    expect(r.lastInteractionAt()).toBeNull();
    r.tickets.addMessage(ref, { author: "andres", body: "a" }, at(6));
    expect(r.lastInteractionAt()).toBe(at(6).toISOString());
  });
});
