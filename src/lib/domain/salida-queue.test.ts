import { describe, expect, it } from "vitest";
import { dayStart, decodeCursor, encodeCursor, inQueue, QUEUE_STAY } from "./salida-queue";
import type { SalidaStatus } from "./types";

// Local days, as the code reads them.
const NOW = new Date(2026, 10, 16, 15, 0, 0);
const DAY = dayStart(NOW);
const iso = (d: number, h = 10) => new Date(2026, 10, d, h).toISOString();
const row = (status: SalidaStatus, created: string, updated = created) => ({ status, createdAt: created, updatedAt: updated });

describe("dayStart", () => {
  it("is local midnight of the day", () => {
    expect(DAY).toBe(new Date(2026, 10, 16, 0, 0, 0, 0).toISOString());
    expect(dayStart(new Date(2026, 10, 16, 23, 59, 59))).toBe(DAY);
  });
});

describe("inQueue (answer A of t204)", () => {
  it("keeps what awaits the signature or is in progress, whatever its date", () => {
    for (const st of QUEUE_STAY) expect(inQueue(row(st, iso(9)), DAY)).toBe(true);
    expect(inQueue(row("pending", iso(1)), DAY)).toBe(true);
  });

  it("moves failed and draft_created from earlier days to the history", () => {
    expect(inQueue(row("failed", iso(12), iso(12, 11)), DAY)).toBe(false);
    expect(inQueue(row("draft_created", iso(12), iso(12, 11)), DAY)).toBe(false);
  });

  it("moves decided ones from earlier days to the history", () => {
    for (const st of ["sent", "denied", "expired", "deleted", "withdrawn"] as const) expect(inQueue(row(st, iso(15), iso(15, 12)), DAY)).toBe(false);
  });

  it("keeps anything created or updated today, failed and draft_created included", () => {
    expect(inQueue(row("failed", iso(16, 9)), DAY)).toBe(true);
    expect(inQueue(row("draft_created", iso(16, 9)), DAY)).toBe(true);
    expect(inQueue(row("sent", iso(16, 9)), DAY)).toBe(true);
    // created yesterday, failed this morning: updated today
    expect(inQueue(row("failed", iso(15), iso(16, 8)), DAY)).toBe(true);
  });

  it("the day starts at local midnight", () => {
    expect(inQueue(row("failed", iso(15, 23), new Date(2026, 10, 15, 23, 59, 59).toISOString()), DAY)).toBe(false);
    expect(inQueue(row("failed", iso(15, 23), new Date(2026, 10, 16, 0, 0, 0).toISOString()), DAY)).toBe(true);
  });

  it("a draft (not proposed yet) is never listed", () => {
    expect(inQueue(row("draft", iso(16)), DAY)).toBe(false);
  });
});

describe("history cursor", () => {
  it("round-trips and refuses garbage", () => {
    const c = { updatedAt: "2026-11-12T15:00:00.000Z", id: "sa_abc" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("nope")).toBeNull();
    expect(decodeCursor("|id")).toBeNull();
    expect(decodeCursor("2026-11-12T15:00:00.000Z|")).toBeNull();
  });
});
