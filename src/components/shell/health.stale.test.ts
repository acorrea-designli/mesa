import { describe, expect, it } from "vitest";
import { clock } from "@/features/hoy/format";
import type { HealthSource, SourceState } from "@/lib/domain/types";
import { mapHealth, railHealth, staleSince, type HealthContext } from "./health";

// The rail kept saying "al día" and showing a pause that had ended after an outage (t129).
const CHECKED = "2026-11-12T17:11:00.000Z";
const at = (min: number) => new Date(Date.parse(CHECKED) + min * 60_000);
const ctx = (min: number, sweeperListening = true): HealthContext => ({ now: at(min), sweeperListening });

const state = (source: HealthSource, over: Partial<SourceState> = {}): SourceState => ({
  source,
  health: "ok",
  note: "",
  watermark: null,
  lastChecked: CHECKED,
  lastNewAt: null,
  backoffUntil: null,
  cadenceS: 60,
  errorCount: 0,
  lastError: null,
  updatedAt: CHECKED,
  ...over,
});

describe("a stale ok row", () => {
  it("reads 'sin revisar desde HH:MM' once lastChecked is older than 3 x cadence, with a 10 minute floor", () => {
    // cadence 60 s: the floor (10 min) wins over 3 x 60 s
    expect(mapHealth(state("github"), ctx(9)).note).toBe("al día");
    const h = mapHealth(state("github"), ctx(11));
    expect(h).toMatchObject({ state: "degraded", note: `sin revisar desde ${clock(CHECKED)}`, legend: `GitHub · sin revisar desde ${clock(CHECKED)}` });
    // cadence 1 h: 3 x cadence = 3 h
    const slow = state("github", { cadenceS: 3600 });
    expect(mapHealth(slow, ctx(179)).note).toBe("al día");
    expect(mapHealth(slow, ctx(181)).note).toBe(`sin revisar desde ${clock(CHECKED)}`);
  });

  it("names the last data and the stale check in the row note", () => {
    const h = mapHealth(state("github", { lastNewAt: "2026-11-12T17:05:00.000Z" }), ctx(30));
    expect(h.rowNote).toBe(`Dato de las ${clock("2026-11-12T17:05:00.000Z")} · GitHub sin revisar desde ${clock(CHECKED)}`);
  });

  it("keeps the default for a source that never checked", () => {
    const never = state("slack", { lastChecked: null });
    expect(staleSince(never, ctx(600, false))).toBeNull();
    expect(mapHealth(never, ctx(600, false))).toMatchObject({ state: "ok", note: "al día" });
  });

  it("does not touch a source that is already down", () => {
    expect(mapHealth(state("github", { health: "down", note: "sin conexión" }), ctx(600))).toMatchObject({ state: "down", note: "sin conexión" });
  });
});

describe("the sweeper's liveness", () => {
  it("makes slack and basecamp stale even when their last check is recent, and leaves the others alone", () => {
    const soon = ctx(1, false);
    for (const s of ["slack", "basecamp"] as const) {
      expect(mapHealth(state(s), soon)).toMatchObject({ state: "degraded", note: `sin revisar desde ${clock(CHECKED)}` });
    }
    for (const s of ["github", "github_project", "calendar"] as const) expect(mapHealth(state(s), soon).note).toBe("al día");
    expect(mapHealth(state("slack"), ctx(1, true)).note).toBe("al día");
  });
});

describe("a pause that ended", () => {
  const paused = (over: Partial<SourceState> = {}) => state("basecamp", { health: "degraded", note: "ENOTFOUND", backoffUntil: at(61).toISOString(), ...over });

  it("is hidden: no 'pausa HH:MM' in the note, the legend or the row note", () => {
    const h = mapHealth(paused(), ctx(62));
    expect(h.note).toBe(`sin revisar desde ${clock(CHECKED)}`);
    for (const text of [h.note, h.legend, h.rowNote]) {
      expect(text).not.toMatch(/pausa/);
    }
  });

  it("falls back to the source note while the check is not stale", () => {
    const h = mapHealth(paused({ lastChecked: at(60).toISOString(), backoffUntil: at(61).toISOString() }), ctx(62));
    expect(h).toMatchObject({ state: "degraded", note: "ENOTFOUND", legend: "Basecamp · ENOTFOUND" });
    expect(h.rowNote).not.toMatch(/pausa/);
  });

  it("still shows a live pause", () => {
    const h = mapHealth(paused({ lastChecked: at(60).toISOString() }), ctx(60));
    expect(h.note).toBe(`pausa ${clock(at(61))}`);
    expect(h.legend).toBe(`Basecamp · en pausa hasta ${clock(at(61))}`);
    expect(h.rowNote).toContain(`Basecamp en pausa hasta ${clock(at(61))}`);
  });
});

describe("railHealth with staleness", () => {
  it("shows the block when the only thing wrong is staleness", () => {
    const rows = [state("github"), state("slack"), state("basecamp")];
    expect(railHealth(rows, true, ctx(5, true))).toEqual([]);
    const shown = railHealth(rows, true, ctx(30, true));
    expect(shown.map((r) => [r.name, r.state])).toEqual([
      ["GitHub", "degraded"],
      ["Slack", "degraded"],
      ["Basecamp", "degraded"],
      ["Claude", "ok"],
    ]);
  });

  it("shows the block when the sweeper is missing and nothing else is wrong", () => {
    const rows = [state("github"), state("slack"), state("basecamp")];
    const shown = railHealth(rows, true, ctx(1, false));
    expect(shown.map((r) => [r.name, r.note])).toEqual([
      ["GitHub", "al día"],
      ["Slack", `sin revisar desde ${clock(CHECKED)}`],
      ["Basecamp", `sin revisar desde ${clock(CHECKED)}`],
      ["Claude", "escucha"],
    ]);
  });

  it("stays quiet when every row is fresh and the sweeper listens", () => {
    expect(railHealth([state("github"), state("slack"), state("basecamp"), state("calendar", { cadenceS: 300 })], true, ctx(2, true))).toEqual([]);
  });
});
