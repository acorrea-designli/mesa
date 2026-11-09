import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/domain/types";
import { applyMove, capCell, cardWait, chipLabel, groupBoard, isQuiet, laneCounts, stationCounts, syncSummary, toCard } from "./model";

const task = (p: Partial<Task> = {}): Task => ({
  id: "ta_1",
  title: "#212 feat: bulk export",
  excerpt: "",
  project: "prospec-admin",
  source: "github",
  station: "inbox",
  waitOn: "you",
  position: 0,
  ghItemId: null,
  ghContentUrl: null,
  syncState: "synced",
  syncError: null,
  syncedAt: "2026-11-03T15:00:00.000Z",
  isSample: true,
  ticketId: null,
  createdAt: "2026-11-03T14:00:00.000Z",
  updatedAt: "2026-11-03T14:00:00.000Z",
  ...p,
});

describe("cards", () => {
  it("labels linked items as chips, own lane first", () => {
    const c = toCard(task(), "09:02", [
      { id: "i2", source: "basecamp", title: "x", url: null, project: "Prospec" },
      { id: "i1", source: "github", title: "#212 feat", url: "https://github.com", project: "prospec-admin", externalId: "pr:o/prospec-admin#212" },
    ]);
    expect(c.chips.map((x) => x.label)).toEqual(["PR #212", "Basecamp · Prospec"]);
    expect(c.sources).toEqual(["github", "basecamp"]);
  });

  it("shows a files chip when a linked item carries meta.files", () => {
    const slack = { id: "i1", source: "slack" as const, title: "x", url: null, project: "Sebastián", meta: { files: [{ id: "F1", name: "image.png", mime: "image/png" }] } };
    expect(toCard(task({ source: "slack" }), "09:02", [slack]).files).toEqual({ kind: "imagen", label: "imagen", count: 1 });
    const pdf = { ...slack, id: "i2", meta: { files: [{ id: "F2", name: "a.pdf", mime: "application/pdf" }] } };
    expect(toCard(task({ source: "slack" }), "09:02", [slack, pdf]).files?.label).toBe("adjunto · 2");
    expect(toCard(task({ source: "slack" }), "09:02", [{ ...slack, meta: {} }]).files).toBeNull();
    expect(toCard(task(), "09:02").files).toBeNull();
  });

  it("names Slack channels and Claude tickets", () => {
    expect(chipLabel({ id: "a", source: "slack", title: "", url: null, project: "", meta: { channel: "#scout-dev" } })).toBe("Slack #scout-dev");
    expect(chipLabel({ id: "a", source: "claude", title: "", url: null, project: "", meta: { ticketRef: "b14" } })).toBe("Ticket b14");
  });

  it("only solid-tags cards waiting on you, none when done", () => {
    expect(cardWait("you", "inbox")?.tone).toBe("you");
    expect(cardWait("claude", "doing")).toEqual({ tone: "cl", label: "Espera a Claude" });
    expect(cardWait("you", "done")).toBeNull();
  });
});

describe("board", () => {
  const cards = [
    toCard(task({ id: "a", position: 2 }), "x"),
    toCard(task({ id: "b", position: 1 }), "x"),
    toCard(task({ id: "c", source: "slack", station: "done" }), "x"),
    toCard(task({ id: "d", source: "basecamp", station: "todo", title: "Exportar PDF" }), "x"),
  ];

  it("groups by lane and station, ordered by position", () => {
    const g = groupBoard(cards);
    expect(g.github.inbox.map((c) => c.id)).toEqual(["b", "a"]);
    expect(g.basecamp.todo).toHaveLength(1);
  });

  it("filters by source and search", () => {
    expect(groupBoard(cards, "basecamp").github.inbox).toHaveLength(0);
    expect(groupBoard(cards, "all", "pdf").basecamp.todo).toHaveLength(1);
    expect(groupBoard(cards, "all", "pdf").github.inbox).toHaveLength(0);
  });

  it("collapses a lane with nothing open", () => {
    const g = groupBoard(cards);
    expect(isQuiet(g, "slack")).toBe(true);
    expect(isQuiet(g, "github")).toBe(false);
  });

  it("caps cells with +N", () => {
    expect(capCell([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(capCell([1, 2])).toEqual({ shown: [1, 2], more: 0 });
  });

  it("counts stations and lanes", () => {
    expect(stationCounts(cards)).toMatchObject({ inbox: 2, todo: 1, done: 1 });
    expect(laneCounts(cards)).toMatchObject({ all: 4, github: 2, slack: 1 });
  });

  it("moves optimistically and shows Sin sincronizar", () => {
    const moved = applyMove(cards, "a", "doing").find((c) => c.id === "a");
    expect(moved).toMatchObject({ station: "doing", syncState: "pending" });
  });
});

describe("sync summary", () => {
  it("reports synced, syncing and error", () => {
    expect(syncSummary([task()]).state).toBe("synced");
    expect(syncSummary([task(), task({ syncState: "pending" })])).toMatchObject({ state: "syncing", synced: 1, total: 2 });
    expect(syncSummary([task({ syncState: "error", syncError: "401" })])).toMatchObject({ state: "error", error: "401", pending: 1 });
    expect(syncSummary([]).state).toBe("empty");
  });
});
