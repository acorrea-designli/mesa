import { describe, expect, it } from "vitest";
import type { Destination } from "@/lib/domain/types";
import {
  SEEN_MAX,
  LAST_SCAN_FRESH_MS,
  SEEN_TTL_MS,
  approvalWaiting,
  decide,
  newKeys,
  salidaWaiting,
  shouldBaseline,
  ticketWaiting,
  type Seen,
  type Waiting,
} from "./decide";

const NOW = Date.UTC(2026, 10, 9, 15, 0, 0);
const dest: Destination = { kind: "slack_channel", workspace: "designli", channel: "#scout-dev", postAs: "Andrés Correa" };

const ticket = (id: string, over: Partial<{ ref: string; title: string; isSample: boolean }> = {}) =>
  ticketWaiting({ id, ref: over.ref ?? `t${id}`, title: over.title ?? "¿Cuál opción?", isSample: over.isSample ?? false });
const salida = (id: string, v = 1, over: Partial<{ isSample: boolean }> = {}, own = false) =>
  salidaWaiting({ id, title: "Respuesta a Matt", destination: dest, currentVersion: v, isSample: over.isSample ?? false }, own);
const approval = (id: string, ticketRef: string | null = "t9") =>
  approvalWaiting({ id, agent: "dev-t9", summary: "Bash: pnpm test", ticketRef, isSample: false });

describe("baseline", () => {
  it("remembers everything that already waits and shows nothing", () => {
    const waiting = [ticket("1"), salida("s1"), approval("a1")];
    const d = decide({ seen: {}, waiting, now: NOW, baseline: true });
    expect(d.show).toEqual([]);
    expect(Object.keys(d.seen).sort()).toEqual(["approval:a1", "salida:s1:v1", "ticket:1"]);
  });

  it("is silent on a reload: the shared seen set already holds them", () => {
    const waiting = [ticket("1"), salida("s1")];
    const first = decide({ seen: {}, waiting, now: NOW, baseline: true });
    const reload = decide({ seen: first.seen, waiting, now: NOW + 1000 });
    expect(reload.show).toEqual([]);
  });
});

describe("new entries", () => {
  it("shows a ticket that enters waiting_andres", () => {
    const d = decide({ seen: {}, waiting: [ticket("1", { ref: "t17", title: "Plan por aprobar" })], now: NOW });
    expect(d.show).toEqual([{ key: "ticket:1", title: "Te espera · t17", body: "Plan por aprobar", url: "/tickets?t=t17" }]);
  });

  it("titles a ticket with an open review as Review lista", () => {
    const w = ticketWaiting({ id: "1", ref: "t17", title: "Review de la PR", isSample: false }, { repo: "designli/scout", pr: 412 });
    const d = decide({ seen: {}, waiting: [w], now: NOW });
    expect(d.show[0]).toMatchObject({ title: "Review lista · designli/scout#412", body: "Review de la PR", url: "/tickets?t=t17" });
  });

  it("shows a pending salida with its destination", () => {
    const d = decide({ seen: {}, waiting: [salida("s1")], now: NOW });
    expect(d.show).toEqual([{ key: "salida:s1:v1", title: "Por firmar · Respuesta a Matt", body: "#scout-dev", url: "/salidas?s=s1" }]);
  });

  it("shows a pending permission and opens its ticket, or Hoy without one", () => {
    const d = decide({ seen: {}, waiting: [approval("a1"), approval("a2", null)], now: NOW });
    expect(d.show.map((s) => [s.title, s.url])).toEqual([
      ["Permiso pendiente · dev-t9", "/tickets?t=t9"],
      ["Permiso pendiente · dev-t9", "/"],
    ]);
  });

  it("only shows what is new when something was already seen", () => {
    const seen = decide({ seen: {}, waiting: [ticket("1")], now: NOW, baseline: true }).seen;
    const d = decide({ seen, waiting: [ticket("1"), ticket("2")], now: NOW + 1 });
    expect(d.show.map((s) => s.key)).toEqual(["ticket:2"]);
  });
});

describe("same key again", () => {
  it("does not repeat a notification while the thing keeps waiting", () => {
    const a = decide({ seen: {}, waiting: [ticket("1"), salida("s1")], now: NOW });
    expect(a.show).toHaveLength(2);
    const b = decide({ seen: a.seen, waiting: [ticket("1"), salida("s1")], now: NOW + 5000 });
    expect(b.show).toEqual([]);
  });

  it("notifies a ticket again when it leaves waiting and a new question enters", () => {
    const a = decide({ seen: {}, waiting: [ticket("1")], now: NOW });
    const left = decide({ seen: a.seen, waiting: [], now: NOW + 1000 });
    expect(left.seen).toEqual({});
    const back = decide({ seen: left.seen, waiting: [ticket("1")], now: NOW + 2000 });
    expect(back.show.map((s) => s.key)).toEqual(["ticket:1"]);
  });
});

describe("salida versions", () => {
  it("notifies a new version of a salida that is still pending", () => {
    const a = decide({ seen: {}, waiting: [salida("s1", 1)], now: NOW });
    const b = decide({ seen: a.seen, waiting: [salida("s1", 2)], now: NOW + 1000 });
    expect(b.show.map((s) => s.key)).toEqual(["salida:s1:v2"]);
  });

  it("does not notify when a salida is back to pending at the same version (undo, unqueue, unschedule)", () => {
    const a = decide({ seen: {}, waiting: [salida("s1", 1)], now: NOW });
    const approved = decide({ seen: a.seen, waiting: [], now: NOW + 1000 }); // approved: left pending
    expect(approved.seen["salida:s1:v1"]).toBeDefined();
    const undone = decide({ seen: approved.seen, waiting: [salida("s1", 1)], now: NOW + 5000 });
    expect(undone.show).toEqual([]);
  });

  it("records a version Andrés wrote himself without showing it", () => {
    const a = decide({ seen: {}, waiting: [salida("s1", 2, {}, true)], now: NOW });
    expect(a.show).toEqual([]);
    expect(a.seen["salida:s1:v2"]).toBe(NOW);
    const b = decide({ seen: a.seen, waiting: [salida("s1", 2)], now: NOW + 1000 });
    expect(b.show).toEqual([]);
  });
});

describe("quiet (someone is looking at Mesa)", () => {
  it("remembers the entry without showing it, so it does not fire later", () => {
    const a = decide({ seen: {}, waiting: [ticket("1")], now: NOW, quiet: true });
    expect(a.show).toEqual([]);
    const b = decide({ seen: a.seen, waiting: [ticket("1")], now: NOW + 1000 });
    expect(b.show).toEqual([]);
  });
});

describe("sample rows", () => {
  it("never notify and are never remembered", () => {
    const waiting = [ticket("1", { isSample: true }), salida("s1", 1, { isSample: true })];
    const d = decide({ seen: {}, waiting, now: NOW });
    expect(d.show).toEqual([]);
    expect(d.seen).toEqual({});
    expect(newKeys({}, waiting)).toEqual([]);
  });
});

describe("sandbox", () => {
  it("prefixes every title", () => {
    const d = decide({ seen: {}, waiting: [ticket("1"), salida("s1"), approval("a1")], now: NOW, sandbox: true });
    expect(d.show.every((s) => s.title.startsWith("[sandbox] "))).toBe(true);
  });
});

describe("pruning", () => {
  it("drops keys older than the TTL and keeps the recent ones", () => {
    const seen: Seen = { "salida:old:v1": NOW - SEEN_TTL_MS - 1, "salida:new:v1": NOW - 1000 };
    const d = decide({ seen, waiting: [], now: NOW });
    expect(Object.keys(d.seen)).toEqual(["salida:new:v1"]);
  });

  it("keeps the set bounded and never drops a key that waits right now", () => {
    const seen: Seen = {};
    for (let i = 0; i < SEEN_MAX + 50; i++) seen[`salida:x${i}:v1`] = NOW - 100_000 + i;
    const waiting: Waiting[] = [salida("x0")]; // the oldest, but still pending
    const d = decide({ seen, waiting, now: NOW });
    expect(Object.keys(d.seen)).toHaveLength(SEEN_MAX);
    expect(d.seen["salida:x0:v1"]).toBe(NOW);
    expect(d.seen[`salida:x${SEEN_MAX + 49}:v1`]).toBeDefined();
    expect(d.seen["salida:x1:v1"]).toBeUndefined();
  });

  it("forgets a ticket the moment it stops waiting", () => {
    const seen = decide({ seen: {}, waiting: [ticket("1"), salida("s1")], now: NOW }).seen;
    const d = decide({ seen, waiting: [salida("s1")], now: NOW + 1 });
    expect(Object.keys(d.seen)).toEqual(["salida:s1:v1"]);
  });
});

describe("first scan after a load (last scan record)", () => {
  it("a recent record means a normal scan: what entered waiting meanwhile notifies", () => {
    expect(shouldBaseline(NOW - 30_000, NOW)).toBe(false);
    expect(shouldBaseline(NOW - LAST_SCAN_FRESH_MS, NOW)).toBe(false);
    const seen = decide({ seen: {}, waiting: [ticket("1")], now: NOW - 30_000, baseline: true }).seen;
    const d = decide({ seen, waiting: [ticket("1"), ticket("2")], now: NOW, baseline: shouldBaseline(NOW - 30_000, NOW) });
    expect(d.show.map((x) => x.url)).toEqual(["/tickets?t=t2"]);
  });

  it("a stale record means a silent baseline", () => {
    expect(shouldBaseline(NOW - LAST_SCAN_FRESH_MS - 1, NOW)).toBe(true);
    const d = decide({ seen: {}, waiting: [ticket("1")], now: NOW, baseline: shouldBaseline(NOW - 3 * 3600_000, NOW) });
    expect(d.show).toEqual([]);
    expect(Object.keys(d.seen)).toEqual(["ticket:1"]);
  });

  it("no record (first enable) or an unreadable one means a silent baseline", () => {
    expect(shouldBaseline(null, NOW)).toBe(true);
    expect(shouldBaseline(Number.NaN, NOW)).toBe(true);
  });

  it("a key already seen stays silent even on a normal first scan", () => {
    const seen = decide({ seen: {}, waiting: [ticket("1")], now: NOW - 1000, baseline: true }).seen;
    const d = decide({ seen, waiting: [ticket("1")], now: NOW, baseline: shouldBaseline(NOW - 1000, NOW) });
    expect(d.show).toEqual([]);
  });
});
