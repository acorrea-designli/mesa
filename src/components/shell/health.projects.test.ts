import { describe, expect, it } from "vitest";
import type { SourceState } from "@/lib/domain/types";
import { mapHealth, railHealth, type HealthContext } from "./health";

const state = (over: Partial<SourceState>): SourceState => ({ source: "github_projects", health: "ok", note: "", watermark: null, lastChecked: "2026-11-13T19:39:00.000Z", lastNewAt: null, backoffUntil: null, cadenceS: 120, errorCount: 0, lastError: null, updatedAt: "2026-11-13T19:39:00.000Z", ...over });

const ctx: HealthContext = { now: new Date("2026-11-13T19:40:00.000Z"), sweeperListening: true };

describe("Proyectos (the /proyectos reader, t152) in the source health", () => {
  it("a rate limit reads as the GitHub limit note under its own name", () => {
    const h = mapHealth(state({ health: "degraded", note: "límite de API · 15:05", backoffUntil: "2026-11-13T20:05:00.000Z" }), ctx);
    expect(h).toMatchObject({ source: "github_projects", state: "degraded", note: "límite de API · 15:05", legend: "Proyectos · límite de API · 15:05" });
  });

  it("stays out of the quiet rail, and shows under GitHub (after GitHub Project) when it fails", () => {
    expect(railHealth([state({})], true, ctx)).toEqual([]);
    const bad = state({ health: "degraded", note: "sin conexión" });
    expect(railHealth([bad], true, ctx).map((r) => r.name)).toEqual(["GitHub", "Proyectos", "Slack", "Basecamp", "Claude"]);
    const gp = { ...state({ health: "down", note: "sin permiso" }), source: "github_project" as const };
    expect(railHealth([gp, bad], true, ctx).map((r) => r.name)).toEqual(["GitHub", "GitHub Project", "Proyectos", "Slack", "Basecamp", "Claude"]);
  });

  it("a stale ok row (the reader stopped) is not ok", () => {
    const h = mapHealth(state({ lastChecked: "2026-11-13T19:00:00.000Z" }), ctx);
    expect(h.state).toBe("degraded");
    expect(h.note).toMatch(/^sin revisar desde/);
  });
});
