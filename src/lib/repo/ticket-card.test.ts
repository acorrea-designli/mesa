// The ticket's status drives its Tablero card (the card follows the ticket), and a reply only goes to
// Andrés when it asks. Both live in the tickets repo; the card moves through tasks.move in the same transaction.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import type { Station } from "../domain/types";
import { createRepos, type Repos } from "./index";

const T0 = new Date("2026-11-03T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
let r: Repos;
let taskId: string;
let ref: string;

const station = () => r.tasks.get(taskId).station;
const newTicket = (withTask: boolean) =>
  r.tickets.create({ direction: "andres_asks", title: "Hacer X", ownerSession: "lead", taskId: withTask ? taskId : undefined }, T0).ref;

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
  taskId = r.tasks.create({ title: "Hacer X", source: "claude" }, T0).id;
  ref = newTicket(true);
});

describe("ticket status -> card station", () => {
  const steps: [string, () => void, Station][] = [
    ["claim (working)", () => r.tickets.transition(ref, { type: "claim" }, "lead", at(1000)), "doing"],
    ["a plan that needs OK (waiting_andres)", () => r.tickets.plan(ref, [{ kind: "x", source: "claude", label: "x", mode: "needs_ok" }], "lead", at(2000)), "waiting"],
    ["Andrés approves the plan (working)", () => r.tickets.approvePlan(ref, [], at(3000)), "doing"],
    ["a question (waiting_andres)", () => r.tickets.addMessage(ref, { author: "claude", body: "¿A o B?", ask: true }, at(4000)), "waiting"],
    ["Andrés answers (waiting_claude)", () => r.tickets.addMessage(ref, { author: "andres", body: "A" }, at(5000)), "doing"],
    ["close (closed)", () => r.tickets.transition(ref, { type: "close", by: "claude" }, undefined, at(6000)), "done"],
    ["reopen (waiting_claude)", () => r.tickets.transition(ref, { type: "reopen" }, undefined, at(7000)), "doing"],
  ];
  steps.forEach(([name, act, to], i) => {
    it(`${name} puts the card in ${to}`, () => {
      // walk the ticket to the state this step starts from, then act
      for (const [, prev] of steps.slice(0, i)) prev();
      act();
      expect(station()).toBe(to);
    });
  });

  it("goes through tasks.move: the card is pending a Project sync and linked items follow", () => {
    const item = r.items.upsert({ source: "claude", externalId: "x", kind: "note", title: "x" }, T0).item;
    r.tasks.linkItems(taskId, [item.id], T0);
    r.tasks.markSync(taskId, { syncState: "synced" }, T0);
    r.tickets.transition(ref, { type: "close", by: "claude" }, undefined, at(1000));
    expect(r.tasks.get(taskId)).toMatchObject({ station: "done", syncState: "pending" });
    expect(r.items.get(item.id).station).toBe("done");
    expect(r.tasks.pendingSync().map((t) => t.id)).toContain(taskId);
  });

  it("a card already at the target station is not touched (no sync noise)", () => {
    r.tasks.move(taskId, "doing", undefined, T0);
    r.tasks.markSync(taskId, { syncState: "synced" }, T0);
    const before = r.tasks.get(taskId);
    r.tickets.transition(ref, { type: "claim" }, "lead", at(1000)); // waiting_claude -> working: both are doing
    expect(r.tasks.get(taskId)).toMatchObject({ station: "doing", syncState: "synced", updatedAt: before.updatedAt });
  });

  it("a ticket without a task does nothing, and so does one whose card is gone", () => {
    const other = newTicket(false);
    r.tickets.transition(other, { type: "close", by: "claude" }, undefined, at(1000));
    expect(station()).toBe("inbox");
    r.tasks.remove(taskId);
    expect(() => r.tickets.transition(ref, { type: "close", by: "claude" }, undefined, at(2000))).not.toThrow();
    expect(r.tickets.get(ref).status).toBe("closed");
  });

  it("a manual move by Andrés stands until the next status change", () => {
    r.tickets.transition(ref, { type: "claim" }, "lead", at(1000));
    r.tasks.move(taskId, "todo", undefined, at(2000));
    r.tickets.addMessage(ref, { author: "claude", body: "voy por la mitad" }, at(3000)); // informational: no status change
    expect(station()).toBe("todo");
    r.tickets.addMessage(ref, { author: "claude", body: "¿A o B?", ask: true }, at(4000));
    expect(station()).toBe("waiting");
  });

  it("a status change is not an Andrés interaction", () => {
    r.tickets.transition(ref, { type: "claim" }, "lead", at(1000));
    r.tickets.transition(ref, { type: "close", by: "claude" }, undefined, at(2000));
    expect(r.lastInteractionAt()).toBeNull();
  });

  it("a failing card move rolls the ticket change back", () => {
    r.tickets.transition(ref, { type: "claim" }, "lead", at(1000));
    r.db.exec("CREATE TRIGGER boom BEFORE UPDATE OF station ON tasks BEGIN SELECT RAISE(ABORT, 'boom'); END");
    expect(() => r.tickets.transition(ref, { type: "close", by: "claude" }, undefined, at(2000))).toThrow(/boom/);
    expect(r.tickets.get(ref)).toMatchObject({ status: "working", closedAt: null });
    expect(station()).toBe("doing");
  });

  it("the auto-reopen of a new PR head brings the card back to doing", () => {
    r.reviews.open(ref, { repo: "acme/api", pr: 7, sha: "old1" }, T0);
    r.tickets.transition(ref, { type: "close", by: "claude" }, undefined, at(1000));
    expect(station()).toBe("done");
    r.reviews.noteHead("acme/api", 7, "new2", {}, at(2000));
    expect(r.tickets.get(ref).status).toBe("waiting_claude");
    expect(station()).toBe("doing");
    expect(r.lastInteractionAt()).toBeNull();
  });
});

describe("a reply goes to Andrés only when it asks", () => {
  const status = () => r.tickets.get(ref).status;

  it("an informational reply keeps the status (working stays working, a pending question stays pending)", () => {
    r.tickets.transition(ref, { type: "claim" }, "lead", at(1000));
    r.tickets.addMessage(ref, { author: "claude", body: "avance", session: "lead" }, at(2000));
    expect(status()).toBe("working");
    r.tickets.addMessage(ref, { author: "claude", body: "¿A o B?", ask: true }, at(3000));
    expect(status()).toBe("waiting_andres");
    r.tickets.addMessage(ref, { author: "claude", body: "más contexto" }, at(4000));
    expect(status()).toBe("waiting_andres");
  });

  it("an informational reply on an unclaimed request turns it into work", () => {
    r.tickets.addMessage(ref, { author: "claude", body: "ya lo miro", session: "lead" }, at(1000));
    expect(status()).toBe("working");
  });

  it("options imply a question; --ask flags one without options", () => {
    r.tickets.addMessage(ref, { author: "claude", body: "elige", options: [{ key: "A", label: "uno" }, { key: "B", label: "dos" }] }, at(1000));
    expect(status()).toBe("waiting_andres");
    r.tickets.addMessage(ref, { author: "andres", body: "A" }, at(2000));
    r.tickets.addMessage(ref, { author: "claude", body: "¿seguro?", ask: true }, at(3000));
    expect(status()).toBe("waiting_andres");
  });

  it("Andrés still wakes the owner, and a plan keeps its rule", () => {
    r.tickets.addMessage(ref, { author: "andres", body: "hola" }, at(1000));
    expect(status()).toBe("waiting_claude");
    r.tickets.plan(ref, [{ kind: "x", source: "claude", label: "x", mode: "direct" }], "lead", at(2000));
    expect(status()).toBe("working");
    r.tickets.plan(ref, [{ kind: "x", source: "claude", label: "x", mode: "needs_ok" }], "lead", at(3000));
    expect(status()).toBe("waiting_andres");
  });
});
