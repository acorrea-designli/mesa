import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/sqlite";
import { createRepos, type Repos } from "@/lib/repo";
import { loadTickets, selectionOrder } from "./read";

let r: Repos;
const T0 = new Date("2026-11-03T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const now = at(60_000);

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
});

const claudeAsks = (title: string, when: Date) => r.tickets.create({ direction: "claude_asks", title, body: title, ownerSession: "lead" }, when);

describe("selectionOrder", () => {
  const rows = [{ ref: "t3" }, { ref: "t2" }];
  it("an explicit ?t= is used as is, with no fallback", () => {
    expect(selectionOrder({ selected: "t2", pinned: "t3" }, rows)).toEqual(["t2"]);
    expect(selectionOrder({ selected: "t9" }, rows)).toEqual(["t9"]);
  });
  it("the landing view (nothing open yet) defaults to the first row", () => {
    expect(selectionOrder({}, rows)).toEqual(["t3"]);
    expect(selectionOrder({}, [])).toEqual([]);
  });
  it("a pinned ticket beats the first row and falls back to it when gone", () => {
    expect(selectionOrder({ pinned: "t2" }, rows)).toEqual(["t2", "t3"]);
  });
  it("the new-request view selects nothing", () => {
    expect(selectionOrder({ creating: true, pinned: "t2" }, rows)).toEqual([]);
  });
});

describe("loadTickets selection", () => {
  it("a new ticket arriving never moves the open one (pinned or ?t=)", () => {
    const a = claudeAsks("A", at(1000));
    const landing = loadTickets(r, {}, now);
    expect(landing.selected?.ticket.ref).toBe(a.ref); // landing: first row
    const b = claudeAsks("B", at(2000));
    expect(loadTickets(r, {}, now).selected?.ticket.ref).toBe(b.ref); // still the landing default
    expect(loadTickets(r, { pinned: a.ref }, now).selected?.ticket.ref).toBe(a.ref);
    expect(loadTickets(r, { selected: a.ref }, now).selected?.ticket.ref).toBe(a.ref);
    expect(loadTickets(r, { pinned: a.ref }, now).rows[0]?.ref).toBe(b.ref); // the list still shows the new one
  });

  it("a message arriving on another ticket does not move the open one", () => {
    const a = claudeAsks("A", at(1000));
    const b = claudeAsks("B", at(2000));
    r.tickets.addMessage(b.id, { author: "claude", body: "ping" }, at(3000));
    expect(loadTickets(r, { pinned: a.ref }, now).selected?.ticket.ref).toBe(a.ref);
  });

  it("a pin that no longer exists falls back to the first row; a bad ?t= shows no thread", () => {
    const a = claudeAsks("A", at(1000));
    expect(loadTickets(r, { pinned: "t999" }, now).selected?.ticket.ref).toBe(a.ref);
    expect(loadTickets(r, { selected: "t999" }, now).selected).toBeNull();
  });

  it("the new-request view has no selected ticket", () => {
    claudeAsks("A", at(1000));
    expect(loadTickets(r, { creating: true }, now).selected).toBeNull();
  });
});

describe("loadTickets read state", () => {
  it("flags the tickets with a message he has not seen, and the selected one", () => {
    const a = claudeAsks("A", at(1000));
    const b = claudeAsks("B", at(2000));
    r.tickets.markSeen(a.id, at(3000));
    const d = loadTickets(r, { pinned: a.ref }, now);
    expect(Object.fromEntries(d.rows.map((x) => [x.ref, x.unread]))).toEqual({ [a.ref]: false, [b.ref]: true });
    expect(d.selectedUnread).toBe(false);
    expect(loadTickets(r, { selected: b.ref }, now).selectedUnread).toBe(true);
  });

  it("opening marks it seen, and a later message from Claude flags it again", () => {
    const a = claudeAsks("A", at(1000));
    expect(loadTickets(r, { selected: a.ref }, now).selectedUnread).toBe(true);
    r.tickets.markSeen(a.ref, at(2000));
    expect(loadTickets(r, { selected: a.ref }, now).rows[0]?.unread).toBe(false);
    r.tickets.addMessage(a.id, { author: "claude", body: "otra cosa" }, at(3000));
    const d = loadTickets(r, { selected: a.ref }, now);
    expect(d.rows[0]?.unread).toBe(true);
    expect(d.selectedUnread).toBe(true);
  });

  it("his own reply never flags the ticket", () => {
    const a = claudeAsks("A", at(1000));
    r.tickets.markSeen(a.ref, at(2000));
    r.tickets.addMessage(a.id, { author: "andres", body: "A" }, at(3000));
    expect(loadTickets(r, { selected: a.ref }, now).rows.find((x) => x.ref === a.ref)?.unread).toBe(false);
  });
});
