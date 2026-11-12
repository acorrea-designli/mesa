import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { subscribeChanges, type LiveChange } from "../live/bus";
import { createRepos, type Repos } from "../repo";
import { LISTENING_GRACE_MS, SWEEPER_GRACE_MS } from "../repo/sessions";
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

  it("keeps the sweeper alive 2 to 4 minutes after its last sign of life, though it is not waiting", () => {
    // beyond the 90 s of a Claude session: a tick or an instance rotation runs outside /api/wait
    expect(LISTENING_GRACE_MS).toBeLessThan(2 * 60_000);
    for (const min of [2, 3, 4]) expect(getSourceHealth(r, at(min))).toEqual([]);
    // Claude's own row still uses its 90 s: nobody else is listening, so the block only shows if something is wrong
    expect(r.sessions.isListening(r.sessions.get("sweeper"), at(2))).toBe(false);
  });

  it("goes stale when the sweeper's 5 minute grace runs out", () => {
    expect(getSourceHealth(r, new Date(T0.getTime() + SWEEPER_GRACE_MS - 1))).toEqual([]);
    const rows = getSourceHealth(r, new Date(T0.getTime() + SWEEPER_GRACE_MS));
    expect(rows.map((x) => [x.name, x.state])).toEqual([
      ["GitHub", "ok"],
      ["Slack", "degraded"],
      ["Basecamp", "degraded"],
      ["Claude", "ok"],
    ]);
    expect(rows.find((x) => x.name === "Claude")?.note).toBe("sin sesión");
  });

  it("stays alive while the sweeper waits, however long ago it was seen", () => {
    r.sessions.setWaiting("sweeper", true, T0);
    for (const s of ["github", "slack", "basecamp"] as const) r.sources.set(s, { lastChecked: at(29).toISOString() }, at(29));
    expect(getSourceHealth(r, at(30))).toEqual([]);
  });
});

describe("HealthWatcher", () => {
  it("records the first pass and publishes once per change", () => {
    const w = new HealthWatcher(r);
    expect(w.check(at(0, 10))).toBe(false); // baseline: quiet rail
    expect(published()).toHaveLength(0);
    // the sweeper was last seen at T0 and has 5 minutes: quiet at 4:00
    expect(w.check(at(4))).toBe(false);
    // its grace ends at 5:00: slack and basecamp turn stale with no write
    expect(w.check(at(5, 1))).toBe(true);
    expect(published()).toHaveLength(1);
    // nothing changed since: the following passes stay silent, even as the clock moves
    expect(w.check(at(5, 30))).toBe(false);
    expect(w.check(at(8))).toBe(false);
    expect(published()).toHaveLength(1);
    // github crosses its 10 minute floor
    expect(w.check(at(11))).toBe(true);
    expect(published()).toHaveLength(2);
    expect(w.check(at(12))).toBe(false);
  });

  it("publishes when a pause ends with no write", () => {
    r.sources.set("basecamp", { health: "degraded", note: "ENOTFOUND", backoffUntil: at(1).toISOString(), lastChecked: T0.toISOString() }, T0);
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
    r.sessions.touch({ id: "lead" }, at(6)); // new session: nobody else is listening (the sweeper's 90 s are long gone)
    const first = published().length;
    expect(first).toBeGreaterThan(0);
    r.sessions.touch({ id: "lead" }, at(6, 20)); // heartbeat, still listening
    r.sessions.setWaiting("lead", true, at(6, 30));
    expect(published()).toHaveLength(first);
  });

  it("publishes when the sweeper comes back, and not when it only heartbeats inside its grace", () => {
    r.sessions.touch({ id: "lead" }, at(6)); // lead listening; the sweeper has been gone since 5:00
    seen = [];
    r.sessions.touch({ id: "sweeper" }, at(6, 10));
    expect(published()).toHaveLength(1);
    r.sessions.touch({ id: "sweeper" }, at(6, 40)); // heartbeat: nothing flips
    expect(published()).toHaveLength(1);
  });
});
