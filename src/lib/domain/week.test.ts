import { describe, expect, it } from "vitest";
import type { Destination } from "./types";
import { breakdownLabel, countOn, dayCounts, destinationSource, doneTotal, filterGroups, groupWeek, kindCounts, mondayOf, newestFirst, normalizeProject, NO_PROJECT, onDay, weekOf, weekText, type DoneRows } from "./week";

describe("week range (America/Bogota)", () => {
  it("runs Monday 00:00 to the next Monday 00:00 Bogota", () => {
    const w = weekOf(new Date("2026-11-11T15:00:00Z")); // Wednesday
    expect(w).toMatchObject({ monday: "2026-11-09", sunday: "2026-11-15", prev: "2026-11-02", next: null, current: true });
    expect(w.startIso).toBe("2026-11-09T05:00:00.000Z");
    expect(w.endIso).toBe("2026-11-16T05:00:00.000Z");
  });

  it("puts Sunday 23:30 Bogota in the old week and Monday 00:30 Bogota in the new one", () => {
    // 2026-11-16T04:30Z is Sunday 23:30 in Bogota; 05:30Z is Monday 00:30.
    expect(weekOf(new Date("2026-11-16T04:30:00Z")).monday).toBe("2026-11-09");
    expect(weekOf(new Date("2026-11-16T05:30:00Z")).monday).toBe("2026-11-16");
  });

  it("normalizes any day to its Monday, allows past weeks, and falls back to the current week on junk or the future", () => {
    const now = new Date("2026-11-11T15:00:00Z");
    expect(weekOf(now, "2026-11-04")).toMatchObject({ monday: "2026-11-02", next: "2026-11-09", current: false });
    expect(weekOf(now, "2026-11-08").monday).toBe("2026-11-02"); // a Sunday
    expect(weekOf(now, "2026-12-01").monday).toBe("2026-11-09");
    expect(weekOf(now, "nope").monday).toBe("2026-11-09");
    expect(weekOf(now, "2026-13-45").monday).toBe("2026-11-09");
  });

  it("mondayOf handles month and year boundaries", () => {
    expect(mondayOf("2026-01-01")).toBe("2025-12-29");
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
  });
});

describe("normalizeProject", () => {
  it("folds repos into clients", () => {
    for (const p of ["dre-frontend", "dre-backend", "dre-infra", "drecentral-e2e", "DRE Central", "7-Arrow/dre-backend", "7-Arrow/anything"]) {
      expect(normalizeProject(p)).toBe("DRE Central");
    }
    for (const p of ["prospec-admin", "prospec-backend", "designli/prospec-frontend"]) expect(normalizeProject(p)).toBe("Prospec");
    for (const p of ["mesa", "ops", "designli/mesa"]) expect(normalizeProject(p)).toBe("Mesa");
  });

  it("keeps the rest as is and names the empty one", () => {
    expect(normalizeProject("designli")).toBe("designli");
    expect(normalizeProject("Christian Ruiz")).toBe("Christian Ruiz");
    expect(normalizeProject("dream-team")).toBe("dream-team");
    expect(normalizeProject("")).toBe(NO_PROJECT);
    expect(normalizeProject(null)).toBe(NO_PROJECT);
  });

  it("grouping by repo shows every project as stored", () => {
    expect(normalizeProject("dre-frontend", "repo")).toBe("dre-frontend");
    expect(normalizeProject("", "repo")).toBe(NO_PROJECT);
  });
});

const gh = (repo: string): Destination => ({ kind: "github_review", repo, pr: 1, postAs: "x" });
const rows = (p: Partial<DoneRows> = {}): DoneRows => ({ tickets: [], salidas: [], reviews: [], tasks: [], ...p });
const ticket = (id: string, project: string, closedAt = "2026-11-10T15:00:00.000Z") => ({ id, ref: id, title: `Hacer ${id}`, project, closedAt, isSample: false });
const salida = (id: string, o: Partial<DoneRows["salidas"][number]> = {}): DoneRows["salidas"][number] => ({
  id,
  title: `Mensaje ${id}`,
  destination: gh("7-Arrow/dre-backend"),
  permalink: `https://example.test/${id}`,
  sentAt: "2026-11-10T16:00:00.000Z",
  ticketRef: null,
  ticketProject: null,
  reviewId: null,
  isSample: false,
  ...o,
});
const task = (id: string, o: Partial<DoneRows["tasks"][number]> = {}): DoneRows["tasks"][number] => ({
  id,
  title: `Tarjeta ${id}`,
  project: "",
  url: null,
  source: "claude",
  at: "2026-11-10T17:00:00.000Z",
  ticketId: null,
  ticketRef: null,
  ticketProject: null,
  isSample: false,
  ...o,
});
const review = (id: string, repo: string, o: Partial<DoneRows["reviews"][number]> = {}): DoneRows["reviews"][number] => ({
  id,
  repo,
  pr: 7,
  at: "2026-11-10T18:00:00.000Z",
  ticketRef: null,
  ticketProject: null,
  isSample: false,
  ...o,
});

describe("groupWeek", () => {
  it("groups by normalized project, then kind in a fixed order, busiest project first and Sin proyecto last", () => {
    const g = groupWeek(
      rows({
        tickets: [ticket("t1", ""), ticket("t2", "dre-frontend"), ticket("t3", "drecentral-e2e")],
        salidas: [salida("s1")],
        reviews: [review("r1", "designli/prospec-admin")],
        tasks: [task("c1", { project: "mesa" })],
      }),
    );
    expect(g.map((x) => [x.name, x.count])).toEqual([
      ["DRE Central", 3],
      ["Mesa", 1],
      ["Prospec", 1],
      [NO_PROJECT, 1],
    ]);
    expect(g[0]!.sections.map((s) => s.kind)).toEqual(["tickets", "mensajes"]);
    expect(g[0]!.sections[0]!.entries.map((e) => e.id)).toEqual(["t2", "t3"]);
  });

  it("sends a salida and a card to their ticket's project when linked, else their own", () => {
    const g = groupWeek(
      rows({
        salidas: [salida("s1", { ticketRef: "t9", ticketProject: "prospec-backend" }), salida("s2", { destination: gh("designli/prospec-admin"), permalink: null })],
        tasks: [task("c1", { project: "other", ticketRef: "t9", ticketProject: "dre-infra" }), task("c2", { project: "" })],
      }),
    );
    const names = Object.fromEntries(g.map((x) => [x.name, x.sections.flatMap((s) => s.entries.map((e) => e.id))]));
    expect(names).toEqual({ Prospec: ["s1", "s2"], "DRE Central": ["c1"], [NO_PROJECT]: ["c2"] });
  });

  it("dedupes: an approval write is a review, and a card whose ticket closed this week is that ticket", () => {
    const g = groupWeek(
      rows({
        tickets: [ticket("tk1", "mesa")],
        salidas: [salida("approve", { reviewId: "r1" }), salida("plain")],
        reviews: [review("r1", "7-Arrow/dre-backend", { pr: 12 })],
        tasks: [task("c1", { ticketId: "tk1", ticketRef: "tk1", ticketProject: "mesa" }), task("c2", { ticketId: "tk-old", ticketRef: "tk-old", ticketProject: "mesa" })],
      }),
    );
    const all = g.flatMap((x) => x.sections.flatMap((s) => s.entries.map((e) => `${e.kind}:${e.id}`)));
    expect(all.sort()).toEqual(["mensajes:plain", "reviews:r1", "tarjetas:c2", "tickets:tk1"]);
  });

  it("links: ticket path, salida permalink (else its ticket), PR url, card url (else its ticket)", () => {
    const g = groupWeek(
      rows({
        tickets: [ticket("t1", "mesa")],
        salidas: [salida("s1", { destination: gh("mesa"), permalink: null, ticketRef: "t1", ticketProject: "mesa" })],
        reviews: [review("r1", "o/mesa", { pr: 5, ticketRef: "t1", ticketProject: "mesa" })],
        tasks: [task("c1", { project: "mesa", url: "https://x.test/c1" }), task("c2", { project: "mesa", ticketId: "z", ticketRef: "t7", ticketProject: "mesa" })],
      }),
    );
    const by = Object.fromEntries(g[0]!.sections.flatMap((s) => s.entries.map((e) => [`${e.kind}:${e.id}`, [e.href, e.external]])));
    expect(by).toEqual({
      "tickets:t1": ["/tickets?t=t1", false],
      "mensajes:s1": ["/tickets?t=t1", false],
      "reviews:r1": ["https://github.com/o/mesa/pull/5", true],
      "tarjetas:c1": ["https://x.test/c1", true],
      "tarjetas:c2": ["/tickets?t=t7", false],
    });
  });

  it("filterGroups keeps one project; an unknown one yields none", () => {
    const g = groupWeek(rows({ tickets: [ticket("t1", "mesa"), ticket("t2", "prospec-admin")] }));
    expect(filterGroups(g, "Prospec").map((x) => x.name)).toEqual(["Prospec"]);
    expect(filterGroups(g, null)).toHaveLength(2);
    expect(filterGroups(g, "Nada")).toEqual([]);
  });

  it("an empty week has no groups", () => {
    expect(groupWeek(rows())).toEqual([]);
  });
});

describe("weekText", () => {
  it("lists project, kind and lines; only external links ride along", () => {
    const g = groupWeek(rows({ tickets: [ticket("t1", "mesa")], salidas: [salida("s1", { destination: gh("mesa") })] }));
    const text = weekText(g, { from: "lun 9 nov", to: "dom 15 nov" }, () => "mar 10 nov");
    expect(text).toBe(
      [
        "Semana del lun 9 nov al dom 15 nov",
        "",
        "Mesa",
        "Tickets cerrados (1)",
        "- mar 10 nov · t1 · Hacer t1",
        "Mensajes enviados (1)",
        "- mar 10 nov · Mensaje s1 — https://example.test/s1",
      ].join("\n"),
    );
  });
});

// Week of Mon 9 Nov 2026 (Bogota is UTC-5). Tue 10: 10:00, 11:00, 13:00, 12:00 Bogota; Wed 11: 00:30 Bogota.
const busy = () =>
  groupWeek(
    rows({
      tickets: [ticket("t1", "mesa"), ticket("t2", "mesa", "2026-11-11T05:30:00.000Z")],
      salidas: [salida("s1", { destination: gh("mesa") })],
      reviews: [review("r1", "o/mesa"), review("r2", "o/mesa", { at: "2026-11-10T03:30:00.000Z" })],
      tasks: [task("c1", { project: "mesa", source: "basecamp" })],
    }),
  );

describe("the page's numbers", () => {
  it("dayCounts: Monday to Sunday in Bogota, with future and today flagged", () => {
    const d = dayCounts(busy(), "2026-11-09", "2026-11-11");
    expect(d.map((x) => x.day)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    // r2 at 03:30Z is Mon 22:30 Bogota; t2 at 05:30Z is Wed 00:30 Bogota.
    expect(d.map((x) => x.count)).toEqual([1, 4, 1, 0, 0, 0, 0]);
    expect(d.map((x) => x.future)).toEqual([false, false, false, true, true, true, true]);
    expect(d.filter((x) => x.today).map((x) => x.day)).toEqual(["2026-11-11"]);
    expect(d.reduce((n, x) => n + x.count, 0)).toBe(doneTotal(busy()));
  });

  it("dayCounts: an empty week is seven zeros", () => {
    expect(dayCounts([], "2026-11-09", "2026-11-09").map((x) => x.count)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("kindCounts: biggest first, ties in the fixed kind order, empty kinds left out", () => {
    expect(kindCounts(busy()).map((k) => [k.kind, k.label, k.count])).toEqual([
      ["tickets", "Tickets cerrados", 2],
      ["reviews", "Reviews aprobadas", 2],
      ["mensajes", "Mensajes enviados", 1],
      ["tarjetas", "Tarjetas hechas", 1],
    ]);
    expect(kindCounts(groupWeek(rows({ tickets: [ticket("t1", "mesa")] })))).toHaveLength(1);
    expect(kindCounts([])).toEqual([]);
  });

  it("countOn and onDay agree: today's total is the day's slice of the week, deduped like the week", () => {
    const g = groupWeek(
      rows({
        tickets: [ticket("tk1", "mesa", "2026-11-09T15:00:00.000Z")],
        // Closed Monday, done Tuesday: a card of a ticket closed this week is that ticket, so it is not counted again.
        tasks: [task("c1", { ticketId: "tk1", ticketRef: "tk1", ticketProject: "mesa" }), task("c2")],
      }),
    );
    expect(countOn(g, "2026-11-09")).toBe(1);
    expect(countOn(g, "2026-11-10")).toBe(1);
    const tue = onDay(busy(), "2026-11-10");
    expect(doneTotal(tue)).toBe(countOn(busy(), "2026-11-10"));
    expect(tue.every((x) => x.count === x.sections.reduce((n, s) => n + s.entries.length, 0))).toBe(true);
    expect(onDay(busy(), "2026-11-13")).toEqual([]);
  });

  it("onDay drops the projects and kinds that have nothing that day", () => {
    const g = groupWeek(rows({ tickets: [ticket("t1", "mesa"), ticket("t2", "prospec-admin", "2026-11-11T15:00:00.000Z")], reviews: [review("r1", "o/mesa", { at: "2026-11-11T15:00:00.000Z" })] }));
    expect(onDay(g, "2026-11-10").map((x) => [x.name, x.sections.map((s) => s.kind)])).toEqual([["Mesa", ["tickets"]]]);
  });

  it("each entry carries its line and tag: tickets Claude, reviews GitHub, messages by destination, cards by source", () => {
    const sl: Destination = { kind: "slack_thread", workspace: "w", channel: "#c", postAs: "x" };
    const bc: Destination = { kind: "basecamp_comment", project: "P", postAs: "x" };
    expect(destinationSource(sl)).toBe("slack");
    expect(destinationSource(bc)).toBe("basecamp");
    expect(destinationSource(gh("a/b"))).toBe("github");
    const g = groupWeek(
      rows({
        tickets: [ticket("t1", "mesa")],
        salidas: [salida("s1", { destination: sl, ticketProject: "mesa", ticketRef: "t1" }), salida("s2", { destination: bc, ticketProject: "mesa" })],
        reviews: [review("r1", "o/mesa")],
        tasks: [task("c1", { project: "mesa", source: "slack" })],
      }),
    );
    const by = Object.fromEntries(newestFirst(g[0]!).map((e) => [e.id, [e.source, e.tag, e.name]]));
    expect(by).toEqual({
      t1: ["claude", "t1", "Hacer t1"],
      s1: ["slack", "mensaje", "Mensaje s1"],
      s2: ["basecamp", "mensaje", "Mensaje s2"],
      r1: ["github", "review", "o/mesa#7"],
      c1: ["slack", "tarjeta", "Tarjeta c1"],
    });
  });

  it("newestFirst lists a project's entries across kinds, latest first", () => {
    const g = groupWeek(rows({ tickets: [ticket("t1", "mesa")], reviews: [review("r1", "o/mesa")], salidas: [salida("s1", { destination: gh("mesa") })] }));
    expect(newestFirst(g[0]!).map((e) => e.id)).toEqual(["r1", "s1", "t1"]);
  });

  it("breakdownLabel: counts per kind, singular at one", () => {
    const g = groupWeek(rows({ tickets: [ticket("t1", "mesa"), ticket("t2", "mesa")], reviews: [review("r1", "o/mesa")] }));
    expect(breakdownLabel(g[0]!)).toBe("2 tickets · 1 review");
  });

  it("weekText names the day when the selection is one day", () => {
    const g = groupWeek(rows({ tickets: [ticket("t1", "mesa")] }));
    expect(weekText(g, { from: "mar 10 nov", to: "mar 10 nov" }, () => "mar 10 nov").split(String.fromCharCode(10))[0]).toBe("Día mar 10 nov");
  });
});
