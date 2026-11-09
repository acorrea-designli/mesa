// The week query: windows, states, sample rows, simulated sends, ignored projects.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "./index";

const T0 = new Date("2026-11-03T10:00:00.000Z");
const IN = "2026-11-10T15:00:00.000Z";
const BEFORE = "2026-11-09T04:59:59.000Z"; // 23:59:59 Sunday, Bogota
const START = "2026-11-09T05:00:00.000Z";
const END = "2026-11-16T05:00:00.000Z";
let r: Repos;
let n = 0;

const win = { start: START, end: END };
const dest = JSON.stringify({ kind: "github_review", repo: "7-Arrow/dre-backend", pr: 3, postAs: "x" });

function ticket(title: string, o: { closedAt?: string | null; project?: string; sample?: boolean } = {}) {
  const t = r.tickets.create({ direction: "andres_asks", title, ownerSession: "lead", project: o.project ?? "", isSample: o.sample }, T0);
  if (o.closedAt !== null) r.db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?").run(o.closedAt ?? IN, t.id);
  return t;
}
function salida(id: string, o: { status?: string; sentAt?: string | null; permalink?: string | null; ticketId?: string | null; sample?: number } = {}) {
  r.db
    .prepare("INSERT INTO salidas (id, status, source, destination, title, ticket_id, sent_at, permalink, is_sample, created_at, updated_at) VALUES (?, ?, 'github', ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, o.status ?? "sent", dest, `Salida ${id}`, o.ticketId ?? null, o.sentAt === undefined ? IN : o.sentAt, o.permalink === undefined ? `https://github.com/x/${id}` : o.permalink, o.sample ?? 0, IN, IN);
}
function review(id: string, o: { state?: string; salidaId?: string | null; updatedAt?: string } = {}) {
  r.db
    .prepare("INSERT INTO reviews (id, repo, pr, state, salida_id, created_at, updated_at) VALUES (?, '7-Arrow/dre-backend', ?, ?, ?, ?, ?)")
    .run(id, ++n, o.state ?? "approved", o.salidaId ?? null, IN, o.updatedAt ?? IN);
}
function card(title: string, o: { station?: string; at?: string; project?: string; sample?: boolean; ticketId?: string } = {}) {
  const t = r.tasks.create({ title, source: "claude", project: o.project ?? "", isSample: o.sample }, T0);
  r.db.prepare("UPDATE tasks SET station = ?, updated_at = ?, ticket_id = ? WHERE id = ?").run(o.station ?? "done", o.at ?? IN, o.ticketId ?? null, t.id);
  return t;
}

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
});

describe("week.done", () => {
  it("takes tickets closed inside [start, end) only", () => {
    ticket("in");
    ticket("before", { closedAt: BEFORE });
    ticket("at end", { closedAt: END });
    ticket("at start", { closedAt: START });
    ticket("open", { closedAt: null });
    expect(r.week.done(win).tickets.map((t) => t.title).sort()).toEqual(["at start", "in"]);
  });

  it("takes sent salidas in the window, with the ticket's ref and project; not unsent, simulated or out-of-window ones", () => {
    const t = ticket("T", { project: "dre-infra" });
    salida("ok", { ticketId: t.id });
    salida("pending", { status: "pending", sentAt: null });
    salida("old", { sentAt: BEFORE });
    salida("sim", { permalink: "sandbox://github/sim" });
    const rows = r.week.done(win).salidas;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "ok", ticketRef: t.ref, ticketProject: "dre-infra", reviewId: null, destination: { repo: "7-Arrow/dre-backend" } });
  });

  it("flags the approval write of an approved review, and dates the review by that write", () => {
    salida("approve");
    review("rv1", { salidaId: "approve", updatedAt: BEFORE });
    review("open", { state: "open" });
    review("late", { updatedAt: END });
    const d = r.week.done(win);
    expect(d.salidas[0]!.reviewId).toBe("rv1");
    expect(d.reviews.map((v) => [v.id, v.at])).toEqual([["rv1", IN]]);
  });

  it("takes done cards updated in the window, with their ticket and the first linked item url", () => {
    const t = ticket("T", { project: "mesa" });
    const c = card("done card", { ticketId: t.id });
    card("moving", { station: "doing" });
    card("old", { at: BEFORE });
    r.items.upsert({ source: "github", externalId: "gh:1", kind: "pr_review", title: "PR", url: "https://github.com/o/r/pull/1", taskId: c.id });
    const rows = r.week.done(win).tasks;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: c.id, ticketId: t.id, ticketRef: t.ref, ticketProject: "mesa", url: "https://github.com/o/r/pull/1" });
  });

  it("leaves out cards of ignored projects (salidas and tickets are never filtered)", () => {
    card("hidden", { project: "secret" });
    card("shown", { project: "mesa" });
    r.ignored.add({ source: "*", project: "secret" });
    expect(r.week.done(win).tasks.map((t) => t.title)).toEqual(["shown"]);
  });

  it("leaves out sample rows unless asked", () => {
    ticket("real");
    ticket("sample", { sample: true });
    salida("s-real");
    salida("s-sample", { sample: 1 });
    card("c-sample", { sample: true });
    const off = r.week.done(win);
    expect([off.tickets.length, off.salidas.length, off.tasks.length]).toEqual([1, 1, 0]);
    const on = r.week.done({ ...win, includeSamples: true });
    expect([on.tickets.length, on.salidas.length, on.tasks.length]).toEqual([2, 2, 1]);
  });
});
