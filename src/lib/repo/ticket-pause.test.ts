// t126: the ticket states "En pausa" (paused) and "En proceso" (ongoing). Repo level (pause, resume, the pause fields on
// list/detail/context, auto-resume when the until-ticket closes by close or fold, the Tablero card) plus the HTTP route.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as TRANSITION } from "@/app/api/tickets/[id]/transition/route";
import { GET as LIST } from "@/app/api/tickets/route";
import { loadTicketNeeds } from "@/features/tickets/needs";
import { loadTickets } from "@/features/tickets/read";
import { ownerChip } from "@/features/tablero/model";
import { openDb } from "../db/sqlite";
import { lastInteractionAt } from "./interaction";
import { eventsAfter } from "../wake/wake";
import { createRepos, type Repos } from "./index";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
const T0 = new Date("2026-11-12T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" }, T0);
});

const mk = (title = "Hacer X", withCard = false) => {
  const taskId = withCard ? r.tasks.create({ title, source: "claude" }, T0).id : undefined;
  const t = r.tickets.create({ direction: "andres_asks", title, ownerSession: "lead", taskId }, T0);
  return { ref: t.ref, id: t.id, taskId };
};
const status = (ref: string) => r.tickets.get(ref).status;
const wakes = (kind: string) => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === kind);
const bodies = (ref: string) => r.tickets.detail(ref).messages.map((m) => m.body);
const needsOf = (ref: string) => {
  const d = r.tickets.detail(ref);
  return loadTicketNeeds(r, [d], at(120_000)).get(d.id)!.map((n) => n.kind);
};

const post = (id: string, body: unknown, headers: Record<string, string> = {}) =>
  TRANSITION(new Request(`http://local/api/tickets/${id}/transition`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

describe("tickets.pause", () => {
  it("pauses from any open status, with the reason, the dependency (as a ref) and the time", () => {
    const dep = mk("Vista de PDF");
    const t = mk();
    const d = r.tickets.pause(t.ref, { kind: "paused", reason: "Espera t-dep", untilTicket: dep.ref, by: "claude" }, at(1000));
    expect(d.status).toBe("paused");
    expect(d).toMatchObject({ pauseReason: "Espera t-dep", pausedUntil: dep.ref, pausedUntilTicketId: dep.id, pausedAt: at(1000).toISOString() });
    // list and detail and the context payload expose the same fields
    expect(r.tickets.list({ status: "paused" }).map((x) => x.ref)).toEqual([t.ref]);
    expect(r.tickets.list({ open: true }).map((x) => x.ref).sort()).toEqual([dep.ref, t.ref].sort());
    expect(r.tickets.list().find((x) => x.ref === t.ref)).toMatchObject({ pauseReason: "Espera t-dep", pausedUntil: dep.ref });
    expect(r.agents.context(t.ref).ticket).toMatchObject({ status: "paused", pauseReason: "Espera t-dep", pausedUntil: dep.ref, pausedAt: at(1000).toISOString() });
    expect(r.tickets.get(dep.ref)).toMatchObject({ pauseReason: null, pausedUntil: null, pausedAt: null });

    for (const from of ["waiting_andres", "waiting_claude", "working", "ongoing"] as const) {
      const x = mk();
      if (from === "waiting_andres") r.tickets.addMessage(x.ref, { author: "claude", body: "¿A o B?", ask: true }, at(10));
      if (from === "working") r.tickets.transition(x.ref, { type: "claim" }, "lead", at(10));
      if (from === "ongoing") r.tickets.pause(x.ref, { kind: "ongoing", reason: "CI", by: "claude" }, at(10));
      expect(status(x.ref)).toBe(from === "ongoing" ? "ongoing" : from);
      expect(r.tickets.pause(x.ref, { kind: "paused", reason: "otra cosa", by: "claude" }, at(20)).status).toBe("paused");
    }
  });

  it("ongoing takes a reason and no dependency; switching kind drops the dependency", () => {
    const dep = mk();
    const t = mk();
    expect(() => r.tickets.pause(t.ref, { kind: "ongoing", reason: "CI", untilTicket: dep.ref, by: "claude" })).toThrow(/only a paused/);
    const d = r.tickets.pause(t.ref, { kind: "ongoing", reason: "CI corriendo", by: "claude" }, at(1000));
    expect(d).toMatchObject({ status: "ongoing", pauseReason: "CI corriendo", pausedUntil: null });
    r.tickets.pause(t.ref, { kind: "paused", reason: "espera", untilTicket: dep.ref, by: "claude" }, at(2000));
    expect(r.tickets.pause(t.ref, { kind: "ongoing", reason: "CI otra vez", by: "claude" }, at(3000))).toMatchObject({ pausedUntil: null, pausedUntilTicketId: null, pausedAt: at(3000).toISOString() });
  });

  it("refuses an empty reason, an unknown, closed or own until-ticket (400) and a closed ticket (409), changing nothing", () => {
    const t = mk();
    const done = mk("cerrado");
    r.tickets.transition(done.ref, { type: "close", by: "claude" }, undefined, at(10));
    for (const bad of [{ reason: "" }, { reason: "   " }, { reason: "x", untilTicket: "t999" }, { reason: "x", untilTicket: done.ref }, { reason: "x", untilTicket: t.ref }]) {
      expect(() => r.tickets.pause(t.ref, { kind: "paused", by: "claude", ...bad }), JSON.stringify(bad)).toThrow();
    }
    expect(status(t.ref)).toBe("waiting_claude");
    expect(() => r.tickets.pause(done.ref, { kind: "paused", reason: "x", by: "claude" })).toThrow(/closed/);
    expect(() => r.tickets.pause(done.ref, { kind: "ongoing", reason: "x", by: "claude" })).toThrow(/closed/);
  });

  it("never wakes; Andrés's pause stamps his interaction, Claude's does not", () => {
    const t = mk();
    r.tickets.pause(t.ref, { kind: "paused", reason: "x", by: "claude" }, at(1000));
    expect(eventsAfter(r.db, "lead", 0).filter((e) => e.kind !== "ticket.created")).toEqual([]);
    expect(lastInteractionAt(r.db)).toBeNull();
    r.tickets.pause(t.ref, { kind: "paused", reason: "y", by: "andres" }, at(2000));
    expect(lastInteractionAt(r.db)).toBe(at(2000).toISOString());
  });

  it("the card follows: paused -> Esperando, ongoing -> En curso, back on resume", () => {
    const t = mk("Con tarjeta", true);
    const station = () => r.tasks.get(t.taskId!).station;
    r.tickets.transition(t.ref, { type: "claim" }, "lead", at(10));
    expect(station()).toBe("doing");
    r.tickets.pause(t.ref, { kind: "paused", reason: "x", by: "claude" }, at(20));
    expect(station()).toBe("waiting");
    r.tickets.pause(t.ref, { kind: "ongoing", reason: "CI", by: "claude" }, at(30));
    expect(station()).toBe("doing");
    r.tickets.pause(t.ref, { kind: "paused", reason: "x", by: "claude" }, at(40));
    expect(station()).toBe("waiting");
    r.tickets.resume(t.ref, { by: "claude" }, at(50));
    expect(station()).toBe("doing");
    r.tickets.pause(t.ref, { kind: "paused", reason: "x", by: "claude" }, at(60));
    r.tickets.resume(t.ref, { by: "andres" }, at(70));
    expect(station()).toBe("doing"); // waiting_claude
  });

  it("the Tablero owner chip reads En pausa · hasta tN / En pausa / En proceso", () => {
    const dep = mk();
    const item = r.items.upsert({ source: "slack", externalId: "C1:9.9", kind: "message", title: "pedido", project: "ops" }, T0).item;
    const t = { ref: r.dispatch.dispatchItems([item.id], {}, T0).results[0]!.ticket.ref, taskId: item.taskId };
    const card = r.items.list().find((i) => i.id === item.id)!.taskId!;
    const chip = () => ownerChip(r.tasks.get(card).owner)?.label;
    r.tickets.pause(t.ref, { kind: "paused", reason: "x", untilTicket: dep.ref, by: "claude" }, at(10));
    expect(chip()).toBe(`En pausa · hasta ${dep.ref}`);
    r.tickets.pause(t.ref, { kind: "paused", reason: "x", by: "claude" }, at(20));
    expect(chip()).toBe("En pausa");
    r.tickets.pause(t.ref, { kind: "ongoing", reason: "CI", by: "claude" }, at(30));
    expect(chip()).toBe("En proceso");
  });
});

describe("tickets.resume", () => {
  it("by Claude: working, no wake, fields cleared", () => {
    const t = mk();
    r.tickets.pause(t.ref, { kind: "ongoing", reason: "CI", by: "claude" }, at(10));
    const d = r.tickets.resume(t.ref, { by: "claude" }, at(20));
    expect(d).toMatchObject({ status: "working", pauseReason: null, pausedUntil: null, pausedAt: null });
    expect(wakes("ticket.resumed")).toEqual([]);
    expect(lastInteractionAt(r.db)).toBeNull();
  });

  it("by Andrés: waiting_claude and ticket.resumed to the owner; an interaction of his", () => {
    const t = mk();
    r.tickets.pause(t.ref, { kind: "paused", reason: "x", by: "claude" }, at(10));
    expect(r.tickets.resume(t.ref, { by: "andres" }, at(20)).status).toBe("waiting_claude");
    const w = wakes("ticket.resumed");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ sessionId: "lead", entityType: "ticket", entityId: t.id });
    expect(w[0]!.payload).toMatchObject({ ref: t.ref, ticketRef: t.ref, by: "andres" });
    expect(lastInteractionAt(r.db)).toBe(at(20).toISOString());
  });

  it("409 unless paused or ongoing", () => {
    const t = mk();
    expect(() => r.tickets.resume(t.ref, { by: "claude" })).toThrow(/not paused/);
    r.tickets.transition(t.ref, { type: "close", by: "claude" }, undefined, at(10));
    expect(() => r.tickets.resume(t.ref, { by: "andres" })).toThrow();
  });
});

describe("leaving paused / ongoing", () => {
  const paused = (kind: "paused" | "ongoing" = "paused", dep?: string) => {
    const t = mk();
    r.tickets.pause(t.ref, { kind, reason: "x", untilTicket: dep, by: "claude" }, at(10));
    return t.ref;
  };

  it("an informational Claude reply stays paused; a question leaves", () => {
    const ref = paused();
    r.tickets.addMessage(ref, { author: "claude", body: "Sigo esperando", session: "lead" }, at(20));
    expect(r.tickets.get(ref)).toMatchObject({ status: "paused", pauseReason: "x" });
    r.tickets.addMessage(ref, { author: "claude", body: "¿Seguimos?", ask: true }, at(30));
    expect(r.tickets.get(ref)).toMatchObject({ status: "waiting_andres", pauseReason: null, pausedAt: null });
  });

  it("Andrés replying goes to waiting_claude with ticket.answered, and clears the pause", () => {
    const dep = mk();
    const ref = paused("paused", dep.ref);
    r.tickets.addMessage(ref, { author: "andres", body: "ya puedes seguir" }, at(20));
    expect(r.tickets.get(ref)).toMatchObject({ status: "waiting_claude", pauseReason: null, pausedUntil: null, pausedUntilTicketId: null });
    expect(wakes("ticket.answered")).toHaveLength(1);
    // the dependency closing later finds nothing to resume
    r.tickets.transition(dep.ref, { type: "close", by: "claude" }, undefined, at(30));
    expect(wakes("ticket.resumed")).toEqual([]);
    expect(status(ref)).toBe("waiting_claude");
  });

  it("a claim, a plan and a close leave it", () => {
    const a = paused("ongoing");
    r.tickets.transition(a, { type: "claim" }, "lead", at(20));
    expect(r.tickets.get(a)).toMatchObject({ status: "working", pauseReason: null });
    const b = paused();
    r.tickets.plan(b, [{ kind: "x", source: "claude", label: "x", mode: "needs_ok" }], "lead", at(20));
    expect(status(b)).toBe("waiting_andres");
    const c = paused();
    r.tickets.plan(c, [{ kind: "x", source: "claude", label: "x", mode: "direct" }], "lead", at(20));
    expect(status(c)).toBe("working");
    const d = paused();
    r.tickets.transition(d, { type: "close", by: "claude" }, undefined, at(20));
    expect(r.tickets.get(d)).toMatchObject({ status: "closed", pauseReason: null, pausedAt: null });
  });

  it("a press of Andrés (andres_acted) leaves it as it is", () => {
    const ref = paused();
    r.tickets.andresActed(ref, at(20));
    expect(status(ref)).toBe("paused");
  });

  it("a paused ticket with an open question or a pending plan step still reads Te espera; one without needs reads nothing", () => {
    const q = paused();
    expect(needsOf(q)).toEqual([]);
    r.tickets.addMessage(q, { author: "claude", body: "Elige", options: [{ key: "A", label: "uno" }, { key: "B", label: "dos" }] }, at(20));
    // asking leaves paused (-> waiting_andres), so pause it again: the question stays open and stays his
    r.tickets.pause(q, { kind: "paused", reason: "x", by: "claude" }, at(30));
    expect(status(q)).toBe("paused");
    expect(needsOf(q)).toContain("answer");

    const p = mk();
    r.tickets.plan(p.ref, [{ kind: "x", source: "claude", label: "x", mode: "needs_ok" }], "lead", at(20));
    r.tickets.pause(p.ref, { kind: "paused", reason: "x", by: "claude" }, at(30));
    expect(needsOf(p.ref)).toEqual(["plan"]);
  });
});

describe("auto-resume when the until-ticket closes", () => {
  it("close: the dependents resume in the same transaction, with a system line and ticket.resumed each", () => {
    const dep = mk("Vista de PDF");
    const a = mk("A");
    const b = mk("B");
    const other = mk("Otro");
    r.tickets.pause(a.ref, { kind: "paused", reason: "espera t-dep", untilTicket: dep.ref, by: "claude" }, at(10));
    r.tickets.pause(b.ref, { kind: "paused", reason: "espera t-dep", untilTicket: dep.ref, by: "claude" }, at(11));
    r.tickets.pause(other.ref, { kind: "paused", reason: "otra cosa", by: "claude" }, at(12));

    r.tickets.transition(dep.ref, { type: "close", by: "claude" }, undefined, at(100));

    for (const x of [a, b]) {
      expect(r.tickets.get(x.ref)).toMatchObject({ status: "waiting_claude", pauseReason: null, pausedUntil: null, pausedUntilTicketId: null, pausedAt: null });
      expect(bodies(x.ref).at(-1)).toBe(`Se cerró ${dep.ref}: vuelve a Claude`);
    }
    expect(status(other.ref)).toBe("paused"); // not waiting for it
    const w = wakes("ticket.resumed");
    expect(w.map((e) => e.entityId).sort()).toEqual([a.id, b.id].sort());
    expect(w[0]!.payload).toMatchObject({ by: "dependency", dependencyRef: dep.ref });
    expect(w.map((e) => (e.payload as { ref: string }).ref).sort()).toEqual([a.ref, b.ref].sort());
    expect(r.tickets.unreadIds().has(a.id)).toBe(true); // the line flags it unread
  });

  it("their cards come back to En curso", () => {
    const dep = mk("dep");
    const t = mk("Con tarjeta", true);
    r.tickets.pause(t.ref, { kind: "paused", reason: "x", untilTicket: dep.ref, by: "claude" }, at(10));
    expect(r.tasks.get(t.taskId!).station).toBe("waiting");
    r.tickets.transition(dep.ref, { type: "close", by: "andres" }, undefined, at(20));
    expect(r.tasks.get(t.taskId!).station).toBe("doing");
  });

  it("fold: the folded ticket closes quietly but its dependents resume", () => {
    const a = r.items.upsert({ source: "slack", externalId: "C1:1.1", kind: "message", title: "uno", project: "ops" }, T0).item;
    const b = r.items.upsert({ source: "slack", externalId: "C1:1.2", kind: "message", title: "dos", project: "ops" }, T0).item;
    const out = r.dispatch.dispatchItems([a.id, b.id], {}, T0);
    const [first, second] = out.results;
    const waiter = mk("Espera al agrupado");
    r.tickets.pause(waiter.ref, { kind: "paused", reason: "espera al segundo", untilTicket: second!.ticket.ref, by: "claude" }, at(10));

    r.tickets.fold(first!.ticket.ref, { from: [second!.ticket.ref], why: "mismo tema" }, at(100));

    expect(status(second!.ticket.ref)).toBe("closed");
    expect(r.tickets.get(waiter.ref)).toMatchObject({ status: "waiting_claude", pausedUntil: null });
    expect(bodies(waiter.ref).at(-1)).toBe(`Se cerró ${second!.ticket.ref}: vuelve a Claude`);
    expect(wakes("ticket.resumed").map((e) => e.entityId)).toEqual([waiter.id]);
  });

  it("skips a dependent that was closed, resumed by hand or switched to ongoing meanwhile; never throws", () => {
    const dep = mk("dep");
    const closed = mk("c");
    const resumed = mk("r");
    const ongoing = mk("o");
    for (const x of [closed, resumed, ongoing]) r.tickets.pause(x.ref, { kind: "paused", reason: "x", untilTicket: dep.ref, by: "claude" }, at(10));
    r.tickets.transition(closed.ref, { type: "close", by: "claude" }, undefined, at(20));
    r.tickets.resume(resumed.ref, { by: "claude" }, at(21));
    r.tickets.pause(ongoing.ref, { kind: "ongoing", reason: "CI", by: "claude" }, at(22));
    expect(() => r.tickets.transition(dep.ref, { type: "close", by: "claude" }, undefined, at(30))).not.toThrow();
    expect(status(closed.ref)).toBe("closed");
    expect(status(resumed.ref)).toBe("working");
    expect(status(ongoing.ref)).toBe("ongoing");
    expect(wakes("ticket.resumed")).toEqual([]);
  });

  it("a reopened dependency does not pause the ticket again", () => {
    const dep = mk("dep");
    const t = mk();
    r.tickets.pause(t.ref, { kind: "paused", reason: "x", untilTicket: dep.ref, by: "claude" }, at(10));
    r.tickets.transition(dep.ref, { type: "close", by: "claude" }, undefined, at(20));
    r.tickets.transition(dep.ref, { type: "reopen" }, undefined, at(30));
    expect(status(t.ref)).toBe("waiting_claude");
    expect(r.tickets.get(t.ref).pausedUntil).toBeNull();
  });
});

describe("Tickets screen", () => {
  it("En pausa lists paused and ongoing tickets, they stay in Abiertos, and the row says why", () => {
    const dep = mk("dep");
    const a = mk("Pausado");
    const b = mk("En proceso");
    const c = mk("Normal");
    r.tickets.pause(a.ref, { kind: "paused", reason: "Espera la vista de PDF", untilTicket: dep.ref, by: "claude" }, at(10));
    r.tickets.pause(b.ref, { kind: "ongoing", reason: "CI corriendo", by: "claude" }, at(11));

    const open = loadTickets(r, {}, at(100));
    expect(open.rows.map((x) => x.ref).sort()).toEqual([a.ref, b.ref, c.ref, dep.ref].sort());
    expect(open.counts).toMatchObject({ open: 4, paused: 2 });
    const tab = loadTickets(r, { tab: "paused" }, at(100));
    expect(tab.tab).toBe("paused");
    expect(tab.rows.map((x) => x.ref).sort()).toEqual([a.ref, b.ref].sort());
    expect(tab.rows.find((x) => x.ref === a.ref)).toMatchObject({ excerpt: `Espera la vista de PDF · hasta ${dep.ref}`, pausedUntil: dep.ref });
    expect(tab.rows.find((x) => x.ref === b.ref)!.excerpt).toBe("CI corriendo");
    expect(tab.rows.every((x) => x.needs.length === 0)).toBe(true); // neither reads Te espera nor Claude trabaja
    expect(loadTickets(r, { tab: "you" }, at(100)).rows).toEqual([]);
  });
});

describe("POST /api/tickets/:id/transition (pause, ongoing, resume)", () => {
  it("pause from the UI is Andrés's and stamps his interaction; the reason is required (400)", async () => {
    const t = mk();
    const bad = await post(t.ref, { event: "pause" });
    expect(bad.status).toBe(400);
    expect((await post(t.ref, { event: "pause", reason: "  " })).status).toBe(400);
    expect(status(t.ref)).toBe("waiting_claude");
    const ok = await post(t.ref, { event: "pause", reason: "espero al cliente" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "paused", pauseReason: "espero al cliente" });
    expect(lastInteractionAt(r.db)).not.toBeNull();
  });

  it("a CLI call is Claude's: no interaction, resume goes to working with no wake", async () => {
    const t = mk();
    const cli = { "x-mesa-client": "cli" };
    expect((await post(t.ref, { event: "ongoing", reason: "CI" }, cli)).status).toBe(200);
    expect(status(t.ref)).toBe("ongoing");
    expect(lastInteractionAt(r.db)).toBeNull();
    const res = await post(t.ref, { event: "resume" }, cli);
    expect(res.status).toBe(200);
    expect(status(t.ref)).toBe("working");
    expect(wakes("ticket.resumed")).toEqual([]);
  });

  it("resume from the UI hands the ticket to Claude and wakes the owner", async () => {
    const t = mk();
    await post(t.ref, { event: "pause", reason: "x" });
    const res = await post(t.ref, { event: "resume" });
    expect(res.status).toBe(200);
    expect(status(t.ref)).toBe("waiting_claude");
    expect(wakes("ticket.resumed")).toHaveLength(1);
  });

  it("until-ticket: unknown, closed or itself -> 400; with ongoing -> 400; a closed ticket -> 409; resume of an open one -> 409", async () => {
    const t = mk();
    const done = mk("cerrado");
    r.tickets.transition(done.ref, { type: "close", by: "claude" }, undefined, at(10));
    for (const untilTicket of ["t999", done.ref, t.ref]) {
      const res = await post(t.ref, { event: "pause", reason: "x", untilTicket });
      expect(res.status, untilTicket).toBe(400);
    }
    expect((await post(t.ref, { event: "ongoing", reason: "x", untilTicket: mk().ref })).status).toBe(400);
    expect(status(t.ref)).toBe("waiting_claude");
    expect((await post(done.ref, { event: "pause", reason: "x" })).status).toBe(409);
    expect((await post(done.ref, { event: "ongoing", reason: "x" })).status).toBe(409);
    expect((await post(t.ref, { event: "resume" })).status).toBe(409);
    const dep = mk("dep");
    expect((await post(t.ref, { event: "pause", reason: "x", untilTicket: dep.ref })).status).toBe(200);
    expect(r.tickets.get(t.ref).pausedUntil).toBe(dep.ref);
    // the dependency closes through the same route: the dependent comes back
    expect((await post(dep.ref, { event: "close", by: "claude" })).status).toBe(200);
    expect(status(t.ref)).toBe("waiting_claude");
  });

  it("GET /api/tickets lists the new statuses with their pause fields", async () => {
    const t = mk();
    r.tickets.pause(t.ref, { kind: "paused", reason: "x", by: "claude" }, at(10));
    const res = await LIST(new Request("http://local/api/tickets?status=paused"), { params: Promise.resolve({}) });
    const rows = (await res.json()) as { ref: string; status: string; pauseReason: string }[];
    expect(rows).toMatchObject([{ ref: t.ref, status: "paused", pauseReason: "x" }]);
  });
});
