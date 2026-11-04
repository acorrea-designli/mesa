import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/domain/types";
import { dispatchToast } from "./api";
import { canDispatch, groupBoard, ignoreTargets, laneIds, ownerChip, rangeIds, readingOrder, selectGroup, stationIds, toCard, toggleId } from "./model";

const task = (p: Partial<Task> = {}): Task => ({
  id: "ta_1",
  title: "Card",
  excerpt: "",
  project: "freightmate",
  source: "basecamp",
  station: "inbox",
  waitOn: "none",
  position: 0,
  ghItemId: null,
  ghContentUrl: null,
  syncState: "synced",
  syncError: null,
  syncedAt: null,
  isSample: false,
  ticketId: null,
  createdAt: "2026-11-03T14:00:00.000Z",
  updatedAt: "2026-11-03T14:00:00.000Z",
  ...p,
});

describe("owner chip", () => {
  it("reads «Claude · por asignar» until the lead spawns the owner, then «agent · state»", () => {
    expect(ownerChip(null)).toBeNull();
    expect(ownerChip({ ticketId: "tk", ticketRef: "t21", ticketStatus: "waiting_claude", agent: null, role: null })).toEqual({
      ticketRef: "t21",
      label: "Claude · por asignar",
      href: "/tickets?t=t21",
      unassigned: true,
      closed: false,
    });
    expect(ownerChip({ ticketId: "tk", ticketRef: "t21", ticketStatus: "working", agent: "tl-t21", role: "tl" })?.label).toBe("tl-t21 · En curso");
    expect(ownerChip({ ticketId: "tk", ticketRef: "t21", ticketStatus: "waiting_andres", agent: "writer-t21", role: "writer" })?.label).toBe("writer-t21 · Te espera");
    expect(ownerChip({ ticketId: "tk", ticketRef: "t21", ticketStatus: "closed", agent: null, role: null })).toMatchObject({ label: "Claude · Cerrado", closed: true, unassigned: false });
  });

  it("Dárselo a Claude only for cards without an open ticket, never for samples", () => {
    const open = toCard(task({ owner: { ticketId: "tk", ticketRef: "t2", ticketStatus: "working", agent: "tl-t2", role: "tl" } }), "9:00");
    const closed = toCard(task({ owner: { ticketId: "tk", ticketRef: "t2", ticketStatus: "closed", agent: null, role: null } }), "9:00");
    expect(canDispatch(toCard(task(), "9:00"))).toBe(true);
    expect(canDispatch(open)).toBe(false);
    expect(canDispatch(closed)).toBe(true);
    expect(canDispatch(toCard(task({ isSample: true }), "9:00"))).toBe(false);
  });
});

describe("selection", () => {
  const cards = [
    toCard(task({ id: "a", source: "github", station: "inbox" }), ""),
    toCard(task({ id: "b", source: "github", station: "todo" }), ""),
    toCard(task({ id: "c", source: "basecamp", station: "inbox", project: "prospec" }), ""),
    toCard(task({ id: "d", source: "basecamp", station: "done" }), ""),
    toCard(task({ id: "e", source: "slack", station: "inbox", project: "" }), ""),
  ];
  const g = groupBoard(cards);

  it("ranges over the reading order, in either direction, anchor included", () => {
    const order = readingOrder(g);
    expect(order.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(rangeIds(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeIds(order, "d", "a")).toEqual(["a", "b", "c", "d"]);
    expect(rangeIds(order, null, "c")).toEqual(["c"]);
    expect(rangeIds(order, "gone", "c")).toEqual(["c"]);
    expect(rangeIds(order, "a", "gone")).toEqual([]);
  });

  it("toggles one card; lane and station select all, or clear when all are in", () => {
    expect([...toggleId(new Set(["a"]), "b")]).toEqual(["a", "b"]);
    expect([...toggleId(new Set(["a", "b"]), "a")]).toEqual(["b"]);
    expect(laneIds(g, "basecamp")).toEqual(["c", "d"]);
    expect(stationIds(g, "inbox")).toEqual(["a", "c", "e"]);
    const s = selectGroup(new Set(["a"]), stationIds(g, "inbox"));
    expect([...s].sort()).toEqual(["a", "c", "e"]);
    expect([...selectGroup(s, stationIds(g, "inbox"))]).toEqual([]);
  });

  it("collects the distinct projects to ignore", () => {
    const t = ignoreTargets(cards);
    expect(t.map((x) => `${x.source}:${x.project}`)).toEqual(["github:freightmate", "basecamp:prospec", "basecamp:freightmate"]);
  });
});

describe("dispatch toast", () => {
  it("names the new tickets, the ones already with Claude and the skipped samples", () => {
    const r = (ref: string, created: boolean) => ({ created, ticket: { id: ref, ref } });
    expect(dispatchToast([r("t21", true), r("t22", true)], 0)).toBe("2 pedidos a Claude · t21, t22");
    expect(dispatchToast([r("t21", true), r("t9", false)], 1)).toBe("1 pedido a Claude · t21 · 1 ya estaba con Claude · 1 de muestra no se envía");
    expect(dispatchToast([], 2)).toBe("2 de muestra no se envían");
  });
});
