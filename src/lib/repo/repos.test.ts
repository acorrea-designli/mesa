import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { TransitionError } from "../db/util";
import { UNDO_WINDOW_MS } from "../domain/salida-machine";
import { eventsAfter, waitForEvents } from "../wake/wake";
import { createRepos, type Repos } from "./index";

let r: Repos;
const T0 = new Date("2026-11-03T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "s1", label: "triage" }, T0);
});

const propose = () =>
  r.salidas.create(
    {
      source: "slack",
      destination: { kind: "slack_thread", workspace: "Designli", channel: "#scout-dev", postAs: "Andrés" },
      body: "Confirmed, SCOUT_API_URL is set on staging.",
      ownerSession: "s1",
    },
    T0,
  );

describe("items and tasks", () => {
  it("upserts items by source + external id", () => {
    const a = r.items.upsert({ source: "github", externalId: "pr:acme/x#1", kind: "pr_review", title: "feat: x" }, T0);
    const b = r.items.upsert({ source: "github", externalId: "pr:acme/x#1", kind: "pr_review", title: "feat: x v2" }, T0);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.item.id).toBe(a.item.id);
    expect(b.item.title).toBe("feat: x v2");
  });

  it("moving a task moves its items and marks it unsynced", () => {
    const it1 = r.items.create({ source: "basecamp", externalId: "rec:1", kind: "request", title: "tarifa" }, T0);
    const t = r.tasks.create({ title: "Tarifa por milla", source: "basecamp", itemIds: [it1.id] }, T0);
    r.tasks.markSync(t.id, { syncState: "synced", ghItemId: "PVTI_1" });
    const moved = r.tasks.move(t.id, "doing");
    expect(moved.syncState).toBe("pending");
    expect(moved.items?.[0]?.id).toBe(it1.id);
    expect(r.items.get(it1.id).station).toBe("doing");
  });
});

describe("salida flow", () => {
  it("approve → undo window → release wakes the owner → sent", () => {
    const s = propose();
    r.salidas.transition(s.id, { type: "approve", version: 1 }, T0);
    expect(r.salidas.sweep(at(UNDO_WINDOW_MS - 1))).toEqual([]);
    expect(() => r.salidas.transition(s.id, { type: "sent" }, at(1000))).toThrow(TransitionError);
    expect(r.salidas.sweep(at(UNDO_WINDOW_MS))).toEqual([s.id]);
    const evs = eventsAfter(r.db, "s1", 0);
    expect(evs.map((e) => e.kind)).toContain("salida.released");
    const sent = r.salidas.transition(s.id, { type: "sent", permalink: "https://slack/p1" }, at(UNDO_WINDOW_MS + 1));
    expect(sent.status).toBe("sent");
  });

  it("a refine turn blocks approve until Claude answers with a version, and learns the chip", () => {
    const s = propose();
    r.salidas.addTurn(s.id, { body: "acórtalo" }, at(1));
    expect(() => r.salidas.transition(s.id, { type: "approve", version: 1 }, at(2))).toThrow(/rewriting/);
    const d = r.salidas.addVersion(s.id, { body: "Confirmed on staging.", author: "claude", chipLabel: "Más corto" }, at(3));
    expect(d.currentVersion).toBe(2);
    expect(d.turns.map((t) => [t.author, t.state])).toEqual([
      ["andres", "answered"],
      ["claude", "answered"],
    ]);
    expect(r.chips.top()[0]).toMatchObject({ label: "Más corto", uses: 1, phrasings: ["acórtalo"] });
    expect(r.salidas.transition(s.id, { type: "approve", version: 2 }, at(4)).status).toBe("sending");
  });

  it("select an older version and star it", () => {
    const s = propose();
    r.salidas.addVersion(s.id, { body: "v2", author: "claude" }, at(1));
    const d = r.salidas.star(s.id, 1, true);
    expect(d.versions[0]?.starred).toBe(true);
    expect(r.salidas.selectVersion(s.id, 1).currentVersion).toBe(1);
  });

  it("manual edit creates tu versión and cancels open turns", () => {
    const s = propose();
    r.salidas.addTurn(s.id, { body: "más formal" }, at(1));
    const d = r.salidas.edit(s.id, "Hand-written text.", at(2));
    expect(d.versions.at(-1)).toMatchObject({ n: 2, author: "andres" });
    expect(d.turns[0]?.state).toBe("cancelled");
  });
});

describe("ticket flow", () => {
  it("Claude asks, Andrés answers, the owner session wakes", async () => {
    const t = r.tickets.create(
      {
        direction: "claude_asks",
        title: "¿Cierro el to-do de Bseen o espero QA?",
        ownerSession: "s1",
        options: [
          { key: "A", label: "Cerrar ahora" },
          { key: "B", label: "Esperar QA" },
        ],
        recommended: "B",
      },
      T0,
    );
    expect(t.ref).toBe("t1");
    expect(t.status).toBe("waiting_andres");
    const waiting = waitForEvents(r.db, { sessionId: "s1", after: 0, timeoutMs: 1000 });
    const d = r.tickets.addMessage(t.id, { author: "andres", body: "B", chosen: "B" }, at(1));
    expect(d.status).toBe("waiting_claude");
    const evs = await waiting;
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: "ticket.answered", entityId: t.id, sessionId: "s1" });
  });

  it("a request with a needs_ok plan waits for approval", () => {
    const t = r.tickets.create({ direction: "andres_asks", title: "Cancela el mensaje a Matt" }, T0);
    expect(eventsAfter(r.db, "s1", 0).map((e) => e.kind)).toEqual(["ticket.created"]);
    const planned = r.tickets.plan(
      t.id,
      [
        { kind: "investigate", source: "claude", label: "Revisar el hilo", mode: "direct" },
        { kind: "cancel_salida", source: "slack", label: "Cancelar la salida a #scout-dev", mode: "needs_ok" },
      ],
      "s1",
    );
    expect(planned.status).toBe("waiting_andres");
    expect(planned.ownerSession).toBe("s1");
    expect(planned.actions.map((a) => a.state)).toEqual(["approved", "planned"]);
    const ok = r.tickets.approvePlan(t.id);
    expect(ok.status).toBe("working");
    expect(ok.actions.every((a) => a.state === "approved")).toBe(true);
  });

  it("approving works when the ticket moved off waiting_andres, and fails with nothing planned", () => {
    const needsOk = [{ kind: "merge_pr", source: "github" as const, label: "Mergear", mode: "needs_ok" as const }];
    for (const move of ["waiting_claude", "working"] as const) {
      const t = r.tickets.create({ direction: "andres_asks", title: `Plan ${move}` }, T0);
      r.tickets.plan(t.id, needsOk, "s1");
      // He writes something (waiting_claude); a session claims the ticket (working): the plan is still waiting for his OK.
      expect(r.tickets.addMessage(t.id, { author: "andres", body: "una duda" }, at(1)).status).toBe("waiting_claude");
      if (move === "working") r.tickets.transition(t.id, { type: "claim" }, "s1", at(1));
      expect(r.tickets.get(t.id).status).toBe(move);
      const ok = r.tickets.approvePlan(t.id, [], at(2));
      expect(ok.status).toBe("working");
      expect(ok.actions.every((a) => a.state === "approved")).toBe(true);
      expect(eventsAfter(r.db, "s1", 0).some((e) => e.kind === "ticket.plan_approved" && e.entityId === t.id)).toBe(true);
      expect(() => r.tickets.approvePlan(t.id)).toThrow(/no plan waiting/);
    }
  });

  describe("pre-approving single steps (approveActions)", () => {
    const steps = [
      { kind: "merge_pr", source: "github" as const, label: "Mergear", mode: "needs_ok" as const },
      { kind: "move_card", source: "github" as const, label: "Mover tarjeta", mode: "needs_ok" as const },
      { kind: "investigate", source: "claude" as const, label: "Revisar", mode: "direct" as const },
    ];
    const planned = () => {
      const t = r.tickets.create({ direction: "andres_asks", title: "Plan con dos OK" }, T0);
      const d = r.tickets.plan(t.id, steps, "s1");
      return { t, merge: d.actions[0]!, move: d.actions[1]!, direct: d.actions[2]! };
    };
    const wakes = (id: string) => eventsAfter(r.db, "s1", 0).filter((e) => e.kind === "ticket.plan_approved" && e.entityId === id);

    it("one step: only it moves to approved, the status stays and the owner wakes with partial: true", () => {
      const { t, merge, move } = planned();
      r.tickets.addMessage(t.id, { author: "andres", body: "ojo" }, at(1)); // waiting_claude
      const d = r.tickets.approveActions(t.id, [merge.id], at(2));
      expect(d.status).toBe("waiting_claude");
      expect(d.actions.map((a) => a.state)).toEqual(["approved", "planned", "approved"]);
      expect(wakes(t.id).map((e) => e.payload)).toEqual([{ ref: t.ref, approved: [merge.id], partial: true }]);
      expect(r.tickets.get(t.id).wokeAt).not.toBeNull();
      void move;
    });

    it("stamps Andrés's interaction", () => {
      const { t, merge } = planned();
      const before = r.db.prepare("SELECT value FROM settings WHERE key = 'last_interaction_at'").get() as { value: string } | undefined;
      r.tickets.approveActions(t.id, [merge.id], at(5000));
      const after = r.db.prepare("SELECT value FROM settings WHERE key = 'last_interaction_at'").get() as { value: string };
      expect(after.value).toBe(at(5000).toISOString());
      expect(before?.value).not.toBe(after.value);
    });

    it("the last planned step is the full approval: working, ticket.plan_approved not partial", () => {
      const { t, merge, move } = planned();
      r.tickets.approveActions(t.id, [merge.id], at(1));
      const d = r.tickets.approveActions(t.id, [move.id], at(2));
      expect(d.status).toBe("working");
      expect(wakes(t.id).map((e) => e.payload)).toEqual([
        { ref: t.ref, approved: [merge.id], partial: true },
        { ref: t.ref, approved: [move.id], partial: false },
      ]);
    });

    it("Aprobar plan afterwards approves only what is still planned and keeps a rejection", () => {
      const { t, merge, move } = planned();
      r.tickets.approveActions(t.id, [merge.id], at(1));
      const d = r.tickets.approvePlan(t.id, [move.id], at(2));
      expect(d.actions.map((a) => a.state)).toEqual(["approved", "rejected", "approved"]);
      expect(d.status).toBe("working");
    });

    it("refuses a step that is direct, already approved, of another ticket, unknown, or an empty list, and a closed ticket", () => {
      const { t, merge, direct } = planned();
      const other = planned();
      expect(() => r.tickets.approveActions(t.id, [direct.id])).toThrow(/ask for OK/);
      expect(() => r.tickets.approveActions(t.id, [other.merge.id])).toThrow(/ask for OK/);
      expect(() => r.tickets.approveActions(t.id, ["pa_nope"])).toThrow(/ask for OK/);
      expect(() => r.tickets.approveActions(t.id, [])).toThrow(/ask for OK/);
      r.tickets.approveActions(t.id, [merge.id]);
      expect(() => r.tickets.approveActions(t.id, [merge.id])).toThrow(/ask for OK/);
      r.tickets.transition(other.t.id, { type: "close", by: "andres" });
      expect(() => r.tickets.approveActions(other.t.id, [other.move.id])).toThrow(/closed/);
      expect(r.tickets.detail(other.t.id).actions[1]!.state).toBe("planned"); // nothing moved
    });

    it("a pre-approved step survives a re-plan (only planned rows are replaced)", () => {
      const { t, merge } = planned();
      r.tickets.approveActions(t.id, [merge.id], at(1));
      const d = r.tickets.plan(t.id, [{ kind: "move_card", source: "github", label: "Mover otra", mode: "needs_ok" }], "s1", at(2));
      expect(d.actions.filter((a) => a.state === "approved" && a.id === merge.id)).toHaveLength(1);
      expect(d.actions.filter((a) => a.state === "planned").map((a) => a.label)).toEqual(["Mover otra"]);
    });
  });

  it("wait times out empty and ignores other sessions' events", async () => {
    r.sessions.touch({ id: "s2" }, T0);
    const t = r.tickets.create({ direction: "claude_asks", title: "q", ownerSession: "s2" }, T0);
    const waiting = waitForEvents(r.db, { sessionId: "s1", after: 0, timeoutMs: 50 });
    r.tickets.addMessage(t.id, { author: "andres", body: "ok" });
    expect(await waiting).toEqual([]);
  });
});

describe("sessions", () => {
  it("an unknown owner session is registered on first use", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "q", ownerSession: "lead" }, T0);
    expect(t.ownerSession).toBe("lead");
    expect(r.sessions.find("lead")).not.toBeNull();
  });
});
