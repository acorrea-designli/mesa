import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { subscribeChanges, type LiveChange } from "../live/bus";
import { createRepos, type Repos } from "../repo";
import { LISTENING_GRACE_MS } from "../repo/sessions";
import { getSourceHealth } from "./health";
import { HealthWatcher } from "./health-ticker";

// The rail changes with the clock and with sessions, not only with writes (t129).
const T0 = new Date("2026-11-12T17:00:00.000Z");
const at = (min: number, s = 0) => new Date(T0.getTime() + min * 60_000 + s * 1000);

let r: Repos;
let seen: LiveChange[];
let off: () => void;
const published = () => seen.filter((c) => c.entityType === "source" && c.kind === "health");

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  seen = [];
  off = subscribeChanges((c) => seen.push(c));
  // every source answered at T0 and the sweeper is on its long poll
  for (const s of ["github", "slack", "basecamp"] as const) r.sources.set(s, { health: "ok", lastChecked: T0.toISOString(), cadenceS: 60 }, T0);
  r.sessions.touch({ id: "sweeper" }, T0);
  seen = [];
});
afterEach(() => off());

describe("getSourceHealth", () => {
  it("is quiet while the checks are fresh and the sweeper is listening", () => {
    expect(getSourceHealth(r, at(0, 30))).toEqual([]);
  });

  it("treats a missing sweeper row as not listening for slack and basecamp only", () => {
    const bare = createRepos(openDb(":memory:"));
    for (const s of ["github", "slack", "basecamp"] as const) bare.sources.set(s, { health: "ok", lastChecked: T0.toISOString(), cadenceS: 60 }, T0);
    const rows = getSourceHealth(bare, at(0, 30));
    expect(rows.map((x) => [x.name, x.state])).toEqual([
      ["GitHub", "ok"],
      ["Slack", "degraded"],
      ["Basecamp", "degraded"],
      ["Claude", "ok"],
    ]);
  });

  it("goes stale when the sweeper's grace runs out", () => {
    expect(getSourceHealth(r, new Date(T0.getTime() + LISTENING_GRACE_MS - 1))).toEqual([]);
    expect(getSourceHealth(r, new Date(T0.getTime() + LISTENING_GRACE_MS)).map((x) => x.state)).toContain("degraded");
  });
});

describe("HealthWatcher", () => {
  it("records the first pass and publishes once per change", () => {
    const w = new HealthWatcher(r);
    expect(w.check(at(0, 10))).toBe(false); // baseline: quiet rail
    expect(published()).toHaveLength(0);
    // the sweeper's grace ends at 1:30: slack and basecamp turn stale with no write
    expect(w.check(at(0, 40))).toBe(false);
    expect(w.check(at(2))).toBe(true);
    expect(published()).toHaveLength(1);
    // nothing changed since: the following passes stay silent, even as the clock moves
    expect(w.check(at(2, 30))).toBe(false);
    expect(w.check(at(5))).toBe(false);
    expect(published()).toHaveLength(1);
    // github crosses its 10 minute floor
    expect(w.check(at(11))).toBe(true);
    expect(published()).toHaveLength(2);
    expect(w.check(at(12))).toBe(false);
  });

  it("publishes when a pause ends with no write", () => {
    r.sources.set("basecamp", { health: "degraded", note: "ENOTFOUND", backoffUntil: at(1).toISOString(), lastChecked: T0.toISOString() }, T0);
    r.sessions.touch({ id: "sweeper" }, at(0, 50)); // keep the sweeper listening at 1:00
    const w = new HealthWatcher(r);
    expect(w.check(at(0, 55))).toBe(false); // baseline: "pausa" shown
    expect(getSourceHealth(r, at(0, 55)).find((x) => x.name === "Basecamp")?.note).toMatch(/^pausa /);
    expect(w.check(at(1, 5))).toBe(true); // the pause is over: "ENOTFOUND"
    expect(getSourceHealth(r, at(1, 5)).find((x) => x.name === "Basecamp")?.note).toBe("ENOTFOUND");
    expect(published()).toHaveLength(1);
  });
});

describe("sessions flipping what the rail shows", () => {
  it("publishes when a session starts listening, not on every heartbeat", () => {
    r.sessions.touch({ id: "lead" }, at(5)); // new session: nobody else listening beyond the sweeper's expired grace
    const first = published().length;
    expect(first).toBeGreaterThan(0);
    r.sessions.touch({ id: "lead" }, at(5, 20)); // heartbeat, still listening
    r.sessions.setWaiting("lead", true, at(5, 30));
    expect(published()).toHaveLength(first);
  });

  it("publishes when the sweeper starts listening again", () => {
    r.sessions.touch({ id: "lead" }, at(5)); // lead listening; sweeper stale since 1:30
    seen = [];
    r.sessions.touch({ id: "sweeper" }, at(5, 10));
    expect(published()).toHaveLength(1);
  });
});
