// t123: the lead's cleanup verbs. `salida withdraw` (draft|pending -> withdrawn, never sends, reason visible, not a
// deny) and `review close` (open -> closed, the ticket leaves Te espera). Repo level plus the HTTP routes.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as CLOSE } from "@/app/api/reviews/[id]/close/route";
import { POST as ACTIONS } from "@/app/api/reviews/[id]/actions/route";
import { POST as TRANSITION } from "@/app/api/salidas/[id]/transition/route";
import { GET as SHOW } from "@/app/api/salidas/[id]/route";
import { loadTicketNeeds } from "@/features/tickets/needs";
import { loadSalidas } from "@/features/salidas/read";
import { collectWaiting } from "@/lib/push/collect";
import { openDb } from "../db/sqlite";
import { lastInteractionAt } from "./interaction";
import { UNDO_WINDOW_MS } from "../domain/salida-machine";
import type { Destination } from "../domain/types";
import { eventsAfter } from "../wake/wake";
import { createRepos, type Repos } from "./index";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
const T0 = new Date("2026-11-09T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const SLACK: Destination = { kind: "slack_channel", workspace: "designli", channel: "#pruebas", postAs: "Andrés" };

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" }, T0);
});

const post = (path: string, body: unknown) =>
  new Request(`http://local${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });
const withdrawHttp = (id: string, body: unknown = { type: "withdraw", reason: "stale" }) => TRANSITION(post(`/api/salidas/${id}/transition`, body), ctx({ id }));
const closeHttp = (id: string, body: unknown = { reason: "stale card" }) => CLOSE(post(`/api/reviews/${id}/close`, body), ctx({ id }));

const needsOf = (ref: string, now = at(120_000)) => {
  const d = r.tickets.detail(ref);
  return loadTicketNeeds(r, [d], now).get(d.id)!.map((n) => n.kind);
};
const status = (ref: string) => r.tickets.get(ref).status;
const stamp = () => lastInteractionAt(r.db);

function pendingSalida(over: { ticketId?: string; draft?: boolean } = {}) {
  return r.salidas.create({ source: "slack", destination: SLACK, body: "hola", title: "Hola", ticketId: over.ticketId, ownerSession: "lead", draft: over.draft }, T0);
}

/** The mesa#36 shape: a review ticket in Te espera with an open review and two pending github salidas (a post, undone, twice). */
function mesa36() {
  const taskId = r.tasks.create({ title: "Revisa PR 7", source: "claude" }, T0).id;
  const t = r.tickets.create({ direction: "andres_asks", title: "Revisa PR 7", ownerSession: "lead", taskId }, T0);
  const rv = r.reviews.open(t.ref, { repo: "acme/api", pr: 7, sha: "abc" }, at(1));
  for (const n of [1, 2]) r.reviews.upsertFinding(t.ref, { repo: "acme/api", pr: 7, n, label: "nit", summary: `finding ${n}`, at: "src/a.ts:1" }, at(2));
  const salidaIds = [1, 2].map((n) => {
    const { salidaIds: ids } = r.reviews.action(rv.id, { action: "post", findingNs: [n] }, at(10_000 * n));
    r.salidas.transition(ids[0]!, { type: "undo" }, at(10_000 * n + UNDO_WINDOW_MS - 1000));
    return ids[0]!;
  });
  // The presses above moved the ticket to waiting_claude; the owner asks again.
  r.tickets.addMessage(t.ref, { author: "claude", body: "Sigue pendiente", ask: true }, at(60_000));
  return { ref: t.ref, id: t.id, reviewId: rv.id, salidaIds };
}

describe("salida withdraw", () => {
  it("closes a pending or draft salida with its reason visible, and it never sends", () => {
    const wake = eventsAfter(r.db, "lead", 0).length;
    for (const draft of [false, true]) {
      const s = pendingSalida({ draft });
      const w = r.salidas.transition(s.id, { type: "withdraw", reason: "stale leftover" }, at(5_000));
      expect(w).toMatchObject({ status: "withdrawn", withdrawReason: "stale leftover", withdrawnAt: at(5_000).toISOString(), approvedVersion: null, sendMode: null, undoUntil: null, releasedAt: null, error: null });
    }
    expect(eventsAfter(r.db, "lead", 0).slice(wake)).toEqual([]); // no salida.released, no salida.denied
  });

  it("is refused (409) from every other status and leaves the salida untouched", async () => {
    const approved = pendingSalida();
    r.salidas.transition(approved.id, { type: "approve", version: 1 }, T0); // sending
    expect((await withdrawHttp(approved.id)).status).toBe(409);
    expect(r.salidas.get(approved.id).status).toBe("sending");

    const denied = pendingSalida();
    r.salidas.transition(denied.id, { type: "deny" }, T0);
    expect((await withdrawHttp(denied.id)).status).toBe(409);

    const gone = pendingSalida();
    r.salidas.transition(gone.id, { type: "withdraw", reason: "x" }, T0);
    expect((await withdrawHttp(gone.id)).status).toBe(409);
    expect(r.salidas.get(gone.id).withdrawReason).toBe("x");
  });

  it("the route needs a non-empty reason (400) and a known salida (404); the API returns the reason", async () => {
    const s = pendingSalida();
    expect((await withdrawHttp(s.id, { type: "withdraw" })).status).toBe(400);
    expect((await withdrawHttp(s.id, { type: "withdraw", reason: "   " })).status).toBe(400);
    expect((await withdrawHttp("sa_nope")).status).toBe(404);
    expect(r.salidas.get(s.id).status).toBe("pending");
    const ok = await withdrawHttp(s.id, { type: "withdraw", reason: "  moot  " });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "withdrawn", withdrawReason: "moot" });
    const shown = await SHOW(new Request(`http://local/api/salidas/${s.id}`), ctx({ id: s.id }));
    expect(await shown.json()).toMatchObject({ status: "withdrawn", withdrawReason: "moot", withdrawnAt: expect.any(String) });
  });

  it("nothing leaves withdrawn: approve, schedule, release, sent, retry, undo and the sweeper do nothing", () => {
    const s = pendingSalida();
    r.salidas.transition(s.id, { type: "withdraw", reason: "x" }, T0);
    for (const ev of [
      { type: "approve", version: 1 },
      { type: "schedule", at: at(3_600_000).toISOString(), version: 1 },
      { type: "release" },
      { type: "sent" },
      { type: "drafted" },
      { type: "retry" },
      { type: "resume" },
      { type: "undo" },
    ] as const) {
      expect(() => r.salidas.transition(s.id, ev, at(UNDO_WINDOW_MS * 5)), ev.type).toThrow();
    }
    expect(r.salidas.sweep(at(7 * 86_400_000))).toEqual([]);
    expect(r.salidas.get(s.id).status).toBe("withdrawn");
  });

  it("is not a deny and not Andrés's press: no interaction stamp, no andresActed, no salida.denied wake", () => {
    const t = r.tickets.create({ direction: "andres_asks", title: "Hilo", ownerSession: "lead" }, T0);
    r.tickets.addMessage(t.ref, { author: "claude", body: "¿ok?", ask: true }, at(1));
    const s = pendingSalida({ ticketId: t.id });
    const before = stamp();
    const wakes = eventsAfter(r.db, "lead", 0).length;
    r.salidas.transition(s.id, { type: "withdraw", reason: "moot" }, at(9_000));
    expect(stamp()).toEqual(before);
    expect(status(t.ref)).toBe("waiting_andres"); // andresActed would have moved it
    expect(eventsAfter(r.db, "lead", 0).slice(wakes).map((e) => e.kind)).toEqual([]);
  });

  it("leaves Por firmar, the pending count, push collect and ticketNeeds; it stays in today's decided strip", () => {
    const t = r.tickets.create({ direction: "andres_asks", title: "Hilo", ownerSession: "lead" }, T0);
    const s = pendingSalida({ ticketId: t.id });
    expect(needsOf(t.ref)).toContain("salida");
    expect(r.salidas.list({ status: ["pending"] }).map((x) => x.id)).toEqual([s.id]);
    const waiting = () => JSON.stringify(collectWaiting(r, null, at(3_000)));
    expect(waiting()).toContain(s.id);
    r.salidas.transition(s.id, { type: "withdraw", reason: "moot" }, at(2_000));
    expect(needsOf(t.ref)).not.toContain("salida");
    expect(r.salidas.list({ status: ["pending"] })).toEqual([]);
    expect(waiting()).not.toContain(s.id);
    expect(loadSalidas(r, at(4_000)).items.find((x) => x.id === s.id)).toMatchObject({ status: "withdrawn", withdrawReason: "moot" });
    expect(JSON.stringify(r.agents.context(t.ref).salidas)).not.toContain(s.id);
  });

  it("a withdrawn github salida frees its findings (they can be posted again) and its review goes back to open", () => {
    const t = r.tickets.create({ direction: "andres_asks", title: "Revisa PR 7", ownerSession: "lead" }, T0);
    const rv = r.reviews.open(t.ref, { repo: "acme/api", pr: 7, sha: "abc" }, at(1));
    r.reviews.upsertFinding(t.ref, { repo: "acme/api", pr: 7, n: 1, label: "nit", summary: "a", at: "src/a.ts:1" }, at(2));
    const { salidaIds } = r.reviews.action(rv.id, { action: "post", findingNs: [1] }, at(10_000));
    r.salidas.transition(salidaIds[0]!, { type: "undo" }, at(11_000));
    expect(r.reviews.findings(t.ref)[0]!.salidaId).toBe(salidaIds[0]);
    expect(() => r.reviews.action(rv.id, { action: "post", findingNs: [1] }, at(12_000))).toThrow(/already posted/);
    r.salidas.transition(salidaIds[0]!, { type: "withdraw", reason: "stale" }, at(13_000));
    expect(r.reviews.findings(t.ref)[0]!.salidaId).toBeNull();
    expect(() => r.reviews.action(rv.id, { action: "post", findingNs: [1] }, at(14_000))).not.toThrow();

    // approving on a withdrawn approve salida: the review goes back to open
    const t2 = r.tickets.create({ direction: "andres_asks", title: "Revisa PR 8", ownerSession: "lead" }, T0);
    const rv2 = r.reviews.open(t2.ref, { repo: "acme/api", pr: 8, sha: "def" }, at(1));
    const a = r.reviews.action(rv2.id, { action: "approve" }, at(20_000));
    r.salidas.transition(a.salidaIds[0]!, { type: "undo" }, at(21_000));
    // the review row still says approving (nothing read it since the undo); the withdrawn salida sends it back to open
    r.salidas.transition(a.salidaIds[0]!, { type: "withdraw", reason: "stale" }, at(22_000));
    expect(r.db.prepare("SELECT state FROM reviews WHERE id = ?").get(rv2.id)).toMatchObject({ state: "approving" });
    expect(r.reviews.get(rv2.id)).toMatchObject({ state: "open", salidaId: null });
  });
});

describe("review close", () => {
  it("closes an open review: reason and time stored, findings kept, nothing wakes, not Andrés's interaction", () => {
    const t = mesa36();
    for (const id of t.salidaIds) r.salidas.transition(id, { type: "withdraw", reason: "stale" }, at(70_000));
    const before = stamp();
    const wakes = eventsAfter(r.db, "lead", 0).length;
    const c = r.reviews.close(t.reviewId, "  stale card of mesa#36 ", at(80_000));
    expect(c).toMatchObject({ state: "closed", closeReason: "stale card of mesa#36", closedAt: at(80_000).toISOString() });
    expect(c.findings).toHaveLength(2);
    expect(stamp()).toEqual(before);
    expect(eventsAfter(r.db, "lead", 0).slice(wakes)).toEqual([]);
  });

  it("the mesa#36 shape: open review + 2 pending salidas, withdraw both, close the review: the ticket has no needs", () => {
    const t = mesa36();
    expect(status(t.ref)).toBe("waiting_andres");
    expect(needsOf(t.ref)).toEqual(["review", "salida"]);
    for (const id of t.salidaIds) r.salidas.transition(id, { type: "withdraw", reason: "stale" }, at(70_000));
    expect(needsOf(t.ref)).toEqual(["review"]);
    expect(status(t.ref)).toBe("waiting_andres");
    r.reviews.close(t.reviewId, "stale", at(80_000));
    expect(needsOf(t.ref)).toEqual([]);
    expect(status(t.ref)).toBe("waiting_claude");
    expect(r.tickets.get(t.ref).wokeAt).toBeNull();
  });

  it("any other need keeps the ticket in Te espera: a pending salida, a planned needs_ok step, another open review", () => {
    const a = mesa36();
    r.reviews.close(a.reviewId, "stale", at(80_000));
    expect(needsOf(a.ref)).toContain("salida");
    expect(status(a.ref)).toBe("waiting_andres");

    const b = r.tickets.create({ direction: "andres_asks", title: "B", ownerSession: "lead" }, T0);
    const rvb = r.reviews.open(b.ref, { repo: "acme/api", pr: 20, sha: "b" }, at(1));
    r.tickets.plan(b.ref, [{ kind: "merge", source: "github", label: "merge", mode: "needs_ok" }], "lead", at(2));
    r.reviews.close(rvb.id, "stale", at(3));
    expect(needsOf(b.ref)).toEqual(["plan"]);
    expect(status(b.ref)).toBe("waiting_andres");

    const c = r.tickets.create({ direction: "andres_asks", title: "C", ownerSession: "lead" }, T0);
    const rv1 = r.reviews.open(c.ref, { repo: "acme/api", pr: 30, sha: "c1" }, at(1));
    r.reviews.open(c.ref, { repo: "acme/api", pr: 31, sha: "c2" }, at(1));
    r.tickets.addMessage(c.ref, { author: "claude", body: "listo", ask: true }, at(2));
    r.reviews.close(rv1.id, "stale", at(3));
    expect(needsOf(c.ref)).toEqual(["review"]);
    expect(status(c.ref)).toBe("waiting_andres");
  });

  it("an open question keeps the ticket in Te espera", () => {
    const t = r.tickets.create({ direction: "andres_asks", title: "Q", ownerSession: "lead" }, T0);
    const rv = r.reviews.open(t.ref, { repo: "acme/api", pr: 40, sha: "q" }, at(1));
    r.tickets.addMessage(t.ref, { author: "claude", body: "¿A o B?", ask: true, options: [{ key: "A", label: "a" }, { key: "B", label: "b" }] }, at(2));
    r.reviews.close(rv.id, "stale", at(3));
    expect(needsOf(t.ref)).toEqual(["answer"]);
    expect(status(t.ref)).toBe("waiting_andres");
  });

  it("refuses approving, approved and closed reviews (409), a missing reason (400) and an unknown one (404)", async () => {
    const t = r.tickets.create({ direction: "andres_asks", title: "Revisa PR 7", ownerSession: "lead" }, T0);
    const rv = r.reviews.open(t.ref, { repo: "acme/api", pr: 7, sha: "abc" }, at(1));
    expect((await closeHttp(rv.id, {})).status).toBe(400);
    expect((await closeHttp(rv.id, { reason: " " })).status).toBe(400);
    expect((await closeHttp("rv_nope")).status).toBe(404);

    const a = r.reviews.action(rv.id, { action: "approve" }, at(10_000));
    expect(() => r.reviews.close(rv.id, "stale", at(10_500))).toThrow(/approving/); // a salida is in flight
    expect(r.reviews.get(rv.id).state).toBe("approving");
    r.salidas.transition(a.salidaIds[0]!, { type: "undo" }, at(11_000)); // pending: the review is open again
    const ok = await closeHttp(rv.id);
    expect(ok.status).toBe(200);
    expect((await ok.json()) as object).toMatchObject({ review: { state: "closed", closeReason: "stale card" } });
    expect((await closeHttp(rv.id)).status).toBe(409); // closing a closed review is refused

    const t2 = r.tickets.create({ direction: "andres_asks", title: "Revisa PR 8", ownerSession: "lead" }, T0);
    const rv2 = r.reviews.open(t2.ref, { repo: "acme/api", pr: 8, sha: "def" }, at(1));
    const b = r.reviews.action(rv2.id, { action: "approve" }, at(10_000));
    r.salidas.transition(b.salidaIds[0]!, { type: "release" }, at(10_000 + UNDO_WINDOW_MS + 1));
    r.salidas.transition(b.salidaIds[0]!, { type: "sent" }, at(10_000 + UNDO_WINDOW_MS + 2));
    expect(r.reviews.get(rv2.id).state).toBe("approved");
    expect((await closeHttp(rv2.id)).status).toBe(409);
  });

  it("review actions on a closed review are refused (409), through /actions too", async () => {
    const t = mesa36();
    r.reviews.close(t.reviewId, "stale", at(80_000));
    for (const action of [{ action: "approve" }, { action: "approve_anyway" }, { action: "post", findingNs: [1] }, { action: "dismiss", findingNs: [1] }, { action: "explain", findingNs: [1] }]) {
      const res = await ACTIONS(post(`/api/reviews/${t.reviewId}/actions`, action), ctx({ id: t.reviewId }));
      expect(res.status, action.action).toBe(409);
    }
    expect(r.reviews.get(t.reviewId).findings.every((f) => f.state === "open")).toBe(true);
  });

  it("review open reopens a closed review at any head (same head too); the GitHub poll does not", () => {
    const t = mesa36();
    r.reviews.close(t.reviewId, "stale", at(80_000));
    r.reviews.noteHead("acme/api", 7, "newhead", {}, at(90_000));
    expect(r.reviews.get(t.reviewId).state).toBe("closed");
    const same = r.reviews.open(t.ref, { repo: "acme/api", pr: 7, sha: "abc" }, at(100_000));
    expect(same).toMatchObject({ state: "open", closeReason: null, closedAt: null, headSha: "abc" });
    r.reviews.close(t.reviewId, "again", at(110_000));
    const moved = r.reviews.open(t.ref, { repo: "acme/api", pr: 7, sha: "def456" }, at(120_000));
    expect(moved).toMatchObject({ state: "open", headSha: "def456" });
  });

  it("the poll may still reopen the ticket of a closed review, as today, and leaves the review closed", () => {
    const t = mesa36();
    r.reviews.close(t.reviewId, "stale", at(80_000));
    r.tickets.transition(t.ref, { type: "close", by: "claude" }, undefined, at(85_000));
    const res = r.reviews.noteHead("acme/api", 7, "newhead", {}, at(90_000));
    expect(res.reopened).toBe(true);
    expect(r.reviews.get(t.reviewId).state).toBe("closed");
  });
});
