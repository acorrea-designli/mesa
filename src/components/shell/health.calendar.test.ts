import { describe, expect, it } from "vitest";
import type { SourceState } from "@/lib/domain/types";
import { mapHealth, railHealth, type HealthContext } from "./health";

const state = (over: Partial<SourceState>): SourceState => ({ source: "calendar", health: "ok", note: "", watermark: null, lastChecked: null, lastNewAt: null, backoffUntil: null, cadenceS: 300, errorCount: 0, lastError: null, updatedAt: "2026-11-11T19:00:00.000Z", ...over });

const ctx: HealthContext = { now: new Date("2026-11-11T19:40:00.000Z"), sweeperListening: true };

describe("Calendario in the source health (t112)", () => {
  it("maps a failing calendar to its own name and note", () => {
    const h = mapHealth(state({ health: "down", note: "Google no entrega el calendario (HTTP 403)" }), ctx);
    expect(h).toMatchObject({ source: "calendar", state: "down", note: "Google no entrega el calendario (HTTP 403)", legend: "Calendario · Google no entrega el calendario (HTTP 403)" });
  });

  it("stays out of the quiet rail until something is wrong, then lists Calendario with the others", () => {
    expect(railHealth([state({})], true, ctx)).toEqual([]);
    const rows = railHealth([state({ health: "degraded", note: "Google no respondió a tiempo", lastNewAt: "2026-11-11T19:39:00.000Z" })], true, ctx);
    expect(rows.map((r) => r.name)).toEqual(["GitHub", "Slack", "Basecamp", "Calendario", "Claude"]);
    expect(rows.find((r) => r.name === "Calendario")).toMatchObject({ source: "calendar", state: "degraded" });
  });

  it("a board without the feed never lists it", () => {
    const rows = railHealth([{ ...state({}), source: "slack", health: "down", note: "sin conexión" }], true, ctx);
    expect(rows.map((r) => r.name)).not.toContain("Calendario");
  });
});
