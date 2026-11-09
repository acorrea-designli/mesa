// t54: a press of Andrés (review action, salida, permission decision) takes his turn on the ticket:
// Te espera becomes Espera a Claude, unless he still owes something (ticketNeeds, from the facts).
import { beforeEach, describe, expect, it } from "vitest";
import { loadTicketNeeds } from "@/features/tickets/needs";
import { openDb } from "../db/sqlite";
import type { Destination, ReviewAction } from "../domain/types";
import { UNDO_WINDOW_MS } from "../domain/salida-machine";
import { eventsAfter } from "../wake/wake";
import { createRepos, type Repos } from "./index";

let r: Repos;
const T0 = new Date("2026-11-09T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

const SLACK: Destination = { kind: "slack_channel", workspace: "designli", channel: "#pruebas", postAs: "Andrés" };

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
});

const needsOf = (ref: string, now = at(60_000)) => {
  const d = r.tickets.detail(ref);
  return loadTicketNeeds(r, [d], now).get(d.id)!.map((n) => n.kind);
};
const status = (ref: string) => r.tickets.get(ref).status;

/** A review ticket parked in waiting_andres by the reviewer's `ticket reply --ask`, with an open review. */
function reviewTicket(findings: { n: number; label: "blocker" | "nit" }[] = [{ n: 1, label: "nit" }]) {
  const taskId = r.tasks.create({ title: "Revisa PR 7", source: "claude" }, T0).id;
  const t = r.tickets.create({ direction: "andres_asks", title: "Revisa PR 7", ownerSession: "lead", taskId }, T0);
  const rv = r.reviews.open(t.ref, { repo: "acme/api", pr: 7, sha: "abc" }, at(1));
  for (const f of findings) r.reviews.upsertFinding(t.ref, { repo: "acme/api", pr: 7, n: f.n, label: f.label, summary: `finding ${f.n}`, at: "src/a.ts:1" }, at(2));
  r.tickets.addMessage(t.ref, { author: "claude", body: "Review lista", ask: true }, at(3));
  return { ref: t.ref, id: t.id, reviewId: rv.id };
}

const ownerAsk = (ref: string, ms: number) => r.tickets.addMessage(ref, { author: "claude", body: "¿sigues ahí?", ask: true }, at(ms));

describe("review actions", () => {
  it("start in Te espera through the review need", () => {
    const t = reviewTicket();
    expect(status(t.ref)).toBe("waiting_andres");
    expect(needsOf(t.ref)).toEqual(["review"]);
  });

  const cases: { action: ReviewAction; findings?: { n: number; label: "blocker" | "nit" }[]; findingNs?: number[] }[] = [
    { action: "approve" },
    { action: "approve_anyway", findings: [{ n: 1, label: "blocker" }] },
    { action: "post", findingNs: [1] },
    { action: "dismiss", findingNs: [1] },
    { action: "explain", findingNs: [1] },
  ];
  for (const c of cases) {
    it(`${c.action} leaves Te espera: no needs, waiting_claude`, () => {
      const t = reviewTicket(c.findings);
      r.reviews.action(t.reviewId, { action: c.action, findingNs: c.findingNs }, at(10_000));
      expect(needsOf(t.ref)).toEqual([]);
      expect(status(t.ref)).toBe("waiting_claude");
    });
  }

  it("moves the card (waiting -> doing) and adds no wake besides review.action", () => {
    const t = reviewTicket();
    expect(r.tasks.get(r.tickets.get(t.ref).taskId!).station).toBe("waiting");
    const before = eventsAfter(r.db, "lead", 0).length;
    r.reviews.action(t.reviewId, { action: "approve" }, at(10_000));
    const kinds = eventsAfter(r.db, "lead", 0).slice(before).map((e) => e.kind);
    expect(kinds).toContain("review.action");
    expect(kinds.filter((k) => k.startsWith("ticket."))).toEqual([]);
    expect(r.tasks.get(r.tickets.get(t.ref).taskId!).station).toBe("doing");
  });

  it("an undo inside the 20 s window gives the turn back through the salida need", () => {
    const t = reviewTicket();
    const { salidaIds } = r.reviews.action(t.reviewId, { action: "approve" }, at(10_000));
    expect(needsOf(t.ref)).toEqual([]);
    r.salidas.transition(salidaIds[0]!, { type: "undo" }, at(10_000 + UNDO_WINDOW_MS - 1000));
    expect(r.salidas.get(salidaIds[0]!).status).toBe("pending");
    expect(needsOf(t.ref)).toEqual(["salida"]);
  });
});

describe("salida presses", () => {
  const propose = (ticketId?: string) => r.salidas.create({ source: "slack", destination: SLACK, body: "hola", ticketId, ownerSession: "lead" }, at(5));
  const asked = () => r.tickets.create({ direction: "claude_asks", title: "Respuesta a Matt", ownerSession: "lead", body: "¿lo mando?" }, T0);

  it("approve, schedule and deny take his turn", () => {
    const run = (ev: Parameters<Repos["salidas"]["transition"]>[1]) => {
      const t = asked();
      const s = propose(t.id);
      expect(status(t.ref)).toBe("waiting_andres");
      r.salidas.transition(s.id, ev, at(1000));
      expect(status(t.ref)).toBe("waiting_claude");
    };
    run({ type: "approve", version: 1 });
    run({ type: "schedule", at: at(3_600_000).toISOString(), version: 1 });
    run({ type: "deny" });
  });

  it("confirm_sent (Ya lo envié) and unqueue take his turn", () => {
    const t = asked();
    const s = propose(t.id);
    r.salidas.transition(s.id, { type: "approve", version: 1 }, at(1000));
    r.salidas.transition(s.id, { type: "release" }, at(1000 + UNDO_WINDOW_MS + 1));
    r.salidas.transition(s.id, { type: "drafted" }, at(2000 + UNDO_WINDOW_MS));
    ownerAsk(t.ref, 3000 + UNDO_WINDOW_MS);
    expect(status(t.ref)).toBe("waiting_andres");
    r.salidas.transition(s.id, { type: "confirm_sent" }, at(4000 + UNDO_WINDOW_MS));
    expect(status(t.ref)).toBe("waiting_claude");

    const u = asked();
    r.sources.set("slack", { health: "down", note: "MCP unreachable" }, at(1));
    const q = propose(u.id);
    expect(r.salidas.transition(q.id, { type: "approve", version: 1 }, at(10)).status).toBe("queued_until_back");
    ownerAsk(u.ref, 20);
    expect(status(u.ref)).toBe("waiting_andres");
    r.salidas.transition(q.id, { type: "unqueue" }, at(30));
    expect(status(u.ref)).toBe("waiting_claude");
  });

  it("session events never take his turn", () => {
    const t = asked();
    const s = propose(t.id);
    r.salidas.addVersion(s.id, { body: "hola v2", author: "claude" }, at(10));
    expect(status(t.ref)).toBe("waiting_andres");
    r.salidas.transition(s.id, { type: "approve", version: 2 }, at(20));
    ownerAsk(t.ref, 30);
    r.salidas.transition(s.id, { type: "release" }, at(40_000));
    r.salidas.transition(s.id, { type: "sent", permalink: "https://x" }, at(41_000));
    expect(status(t.ref)).toBe("waiting_andres");
  });

  it("a salida with no ticket and a closed ticket are left alone", () => {
    const s = propose();
    expect(() => r.salidas.transition(s.id, { type: "approve", version: 1 }, at(10))).not.toThrow();
    const t = asked();
    const s2 = propose(t.id);
    r.tickets.transition(t.ref, { type: "close", by: "andres" }, undefined, at(20));
    const closedAt = r.tickets.get(t.ref).closedAt;
    r.salidas.transition(s2.id, { type: "deny" }, at(30));
    expect(status(t.ref)).toBe("closed");
    expect(r.tickets.get(t.ref).closedAt).toBe(closedAt);
  });

  it("the seed never takes his turn", () => {
    const t = asked();
    const s = propose(t.id);
    r.salidas.transition(s.id, { type: "approve", version: 1 }, at(10), { seed: true });
    expect(status(t.ref)).toBe("waiting_andres");
  });
});

describe("permission decisions", () => {
  const ask = () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "Necesito correr git", ownerSession: "lead", body: "?" }, T0);
    const a = r.approvals.create({ ticketRef: t.ref, agent: "dev-t1", tool: "Bash", summary: "git push" }, at(1));
    return { t, a };
  };

  for (const decision of ["allow", "deny", "read_config"] as const) {
    it(`${decision} by Andrés takes his turn`, () => {
      const { t, a } = ask();
      r.approvals.decide(a.id, { decision, actor: "andres" }, at(1000));
      expect(status(t.ref)).toBe("waiting_claude");
    });
  }

  it("a session decision or an expiry does not", () => {
    const { t, a } = ask();
    r.approvals.decide(a.id, { decision: "deny", actor: "lead" }, at(1000));
    expect(status(t.ref)).toBe("waiting_andres");
    const b = ask();
    r.approvals.expire(at(60 * 60_000));
    expect(r.approvals.get(b.a.id).status).toBe("expired");
    expect(status(b.t.ref)).toBe("waiting_andres");
  });

  it("the seed flag keeps a sample decision from moving the ticket", () => {
    const { t, a } = ask();
    r.approvals.decide(a.id, { decision: "allow", actor: "andres" }, at(1000), { seed: true });
    expect(status(t.ref)).toBe("waiting_andres");
  });
});

describe("what he still owes keeps Te espera", () => {
  const asked = () => r.tickets.create({ direction: "claude_asks", title: "Varias cosas", ownerSession: "lead", body: "hola" }, T0);
  const salida = (ticketId: string, ms: number) => r.salidas.create({ source: "slack", destination: SLACK, body: "hola", ticketId, ownerSession: "lead" }, at(ms));

  it("another pending salida", () => {
    const t = asked();
    const [a, b] = [salida(t.id, 1), salida(t.id, 2)];
    r.salidas.transition(a.id, { type: "approve", version: 1 }, at(10));
    expect(needsOf(t.ref)).toEqual(["salida"]);
    r.salidas.transition(b.id, { type: "deny" }, at(11));
    expect(needsOf(t.ref)).toEqual([]);
  });

  it("another pending permission", () => {
    const t = asked();
    const [a, b] = [1, 2].map((n) => r.approvals.create({ ticketRef: t.ref, agent: `dev-${n}`, tool: "Bash", summary: "x" }, at(n)));
    r.approvals.decide(a!.id, { decision: "allow", actor: "andres" }, at(10));
    expect(needsOf(t.ref)).toEqual(["permission"]);
    r.approvals.decide(b!.id, { decision: "deny", actor: "andres" }, at(11));
    expect(needsOf(t.ref)).toEqual([]);
  });

  it("an unanswered options question", () => {
    const t = asked();
    r.tickets.addMessage(t.ref, { author: "claude", body: "A o B?", options: [{ key: "A", label: "uno" }, { key: "B", label: "dos" }], recommended: "A" }, at(1));
    const s = salida(t.id, 2);
    r.salidas.transition(s.id, { type: "deny" }, at(10));
    expect(status(t.ref)).toBe("waiting_claude");
    expect(needsOf(t.ref)).toEqual(["answer"]);
  });

  it("needs_ok steps still planned", () => {
    const t = asked();
    r.tickets.plan(
      t.ref,
      [
        { kind: "x", source: "claude", label: "uno", mode: "needs_ok" },
        { kind: "y", source: "claude", label: "dos", mode: "needs_ok" },
      ],
      "lead",
      at(1),
    );
    const s = salida(t.id, 2);
    r.salidas.transition(s.id, { type: "deny" }, at(10));
    expect(needsOf(t.ref)).toEqual(["plan"]);
  });
});
