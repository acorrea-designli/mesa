// "Pídeme permiso" (t10 improvement 10): the permission-request message and its wake, the lead's focus,
// and the actor rule for the raw /decision route.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { NotFoundError, TransitionError } from "../db/util";
import { claimsAndres } from "../domain/approval-actor";
import { transitionTicket } from "../domain/ticket-machine";
import { eventsAfter } from "../wake/wake";
import { createRepos, type Repos } from "./index";

let r: Repos;
const T0 = new Date("2026-11-03T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
let ref: string;

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
  ref = r.tickets.create({ direction: "andres_asks", title: "Sube el reporte", ownerSession: "lead", project: "scout" }, T0).ref;
});

const wakes = (kind: string) => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === kind);

describe("requestPermission", () => {
  it("posts a marked andres message that refers to the latest Claude message, and wakes the owner", () => {
    r.tickets.addMessage(ref, { author: "claude", body: "primero" }, at(1));
    const second = r.tickets.addMessage(ref, { author: "claude", body: "segundo" }, at(2)).messages.at(-1)!;
    const d = r.tickets.requestPermission(ref, at(3));
    const m = d.messages.at(-1)!;
    expect(m).toMatchObject({ author: "andres", body: "Pídeme permiso", kind: "permission_request", aboutMessageId: second.id });
    expect(d.messages.filter((x) => x.kind).length).toBe(1);
    const [w] = wakes("ticket.permission_requested");
    expect(w).toMatchObject({ sessionId: "lead", entityType: "ticket", entityId: d.id });
    expect(w!.payload).toEqual({ ref, ticketRef: ref, messageId: m.id });
    // it is a request for a card, not an answer: no ticket.answered wake
    expect(wakes("ticket.answered")).toEqual([]);
  });

  it("works without any Claude message, and a Claude ask goes back to Claude's turn", () => {
    const asked = r.tickets.create({ direction: "claude_asks", title: "¿A o B?", ownerSession: "lead", body: "¿A o B?" }, at(1));
    expect(asked.status).toBe("waiting_andres");
    const d = r.tickets.requestPermission(asked.ref, at(2));
    expect(d.status).toBe("waiting_claude");
    expect(d.messages.at(-1)!.aboutMessageId).toBe(asked.messages[0]!.id);
    const own = r.tickets.requestPermission(ref, at(3));
    expect(own.messages.at(-1)!.aboutMessageId).toBeNull();
    expect(own.status).toBe("waiting_claude");
  });

  it("leaves a working ticket working", () => {
    r.tickets.transition(ref, { type: "claim" }, "lead", at(1));
    expect(r.tickets.requestPermission(ref, at(2)).status).toBe("working");
  });

  it("is refused on a closed ticket and wakes nobody", () => {
    r.tickets.transition(ref, { type: "close", by: "andres" }, undefined, at(1));
    expect(() => r.tickets.requestPermission(ref, at(2))).toThrow(TransitionError);
    expect(wakes("ticket.permission_requested")).toEqual([]);
    expect(r.tickets.detail(ref).messages.some((m) => m.kind)).toBe(false);
  });

  it("never touches approvals: Mesa files no card and edits no settings", () => {
    r.tickets.requestPermission(ref, at(1));
    expect(r.approvals.list()).toEqual([]);
  });

  it("the machine event only wakes and never closes or reopens", () => {
    expect(transitionTicket("closed", { type: "permission_request" }).ok).toBe(false);
    expect(transitionTicket("waiting_claude", { type: "permission_request" })).toEqual({ ok: true, status: "waiting_claude", wake: "ticket.permission_requested" });
  });
});

describe("lead focus", () => {
  it("is empty until set, names an open ticket, and clears", () => {
    expect(r.focus.get()).toBeNull();
    expect(r.focus.set(ref)).toBe(ref);
    expect(r.focus.get()).toBe(ref);
    r.focus.clear();
    expect(r.focus.get()).toBeNull();
  });

  it("refuses an unknown or closed ticket, and a ticket closed later reads as no focus", () => {
    expect(() => r.focus.set("t999")).toThrow(NotFoundError);
    r.tickets.transition(ref, { type: "close", by: "andres" }, undefined, at(1));
    expect(() => r.focus.set(ref)).toThrow(TransitionError);
    const other = r.tickets.create({ direction: "andres_asks", title: "otro", ownerSession: "lead" }, at(2)).ref;
    r.focus.set(other);
    r.tickets.transition(other, { type: "close", by: "andres" }, undefined, at(3));
    expect(r.focus.get()).toBeNull();
  });

  it("accepts a ticket by id and stores its ref", () => {
    const id = r.tickets.get(ref).id;
    expect(r.focus.set(id)).toBe(ref);
  });
});

describe("claimsAndres", () => {
  it("catches every spelling that names him and lets the hook's own actor through", () => {
    for (const a of ["andres", "Andres", "ANDRÉS", " andrés ", "Andrés Correa", "acorrea-designli", "andres.correa@designli.co", "tm_andres"]) expect(claimsAndres(a), a).toBe(true);
    for (const a of ["mesa-approval-hook", "hook", "dev-t10-5", "lead"]) expect(claimsAndres(a), a).toBe(false);
  });
});
