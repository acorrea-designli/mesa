// The /proyectos screen model (t152 PR 2) over the seeded cache: what each state of the mock shows.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/sqlite";
import { createRepos, type Repos } from "@/lib/repo";
import { loadProjects } from "@/lib/integrations/projects-config";
import { blockerQuote, loadProjectsPayload } from "@/lib/integrations/projects-view";
import { seedProyectosFixture, type FixtureOptions } from "./fixture";
import { blockRows, issuePrefixOf, lineLabels, parseQuery, pjHref, screenModel, SIN_ISSUE, TREN, type Block, type PjQuery, type Screen } from "./model";

const NOW = new Date("2026-11-13T15:42:00.000Z");
const LOGIN = "acorrea-designli";
let r: Repos;

function screen(raw: Record<string, string> = {}, o: Partial<FixtureOptions> = {}): Screen {
  seedProyectosFixture(r, NOW, { login: LOGIN, ...o });
  const q = parseQuery(raw);
  const config = loadProjects();
  const payload = loadProjectsPayload(r, q.proyecto, { login: LOGIN, config, now: NOW });
  const p = config.projects.find((x) => x.key === payload.view?.key);
  const sel = q.pr ? payload.view?.prs.find((x) => x.key === q.pr) : undefined;
  return screenModel(payload, q, NOW, { issuePrefix: issuePrefixOf(p?.issueKeys ?? []), issueRepo: p?.issueRepo, blockerQuote: sel?.mesa ? blockerQuote(r.db, sel.mesa.id) : null });
}

const titles = (bs: Block[]) => bs.map((b) => (b.kind === "issue" ? b.label : b.kind === "group" ? b.title : `tren:${b.title}`));

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
});

describe("the URL", () => {
  it("reads proyecto, estacion, vista and pr, and drops what is not valid", () => {
    expect(parseQuery({ proyecto: "dre", estacion: "In QA", vista: "todo", pr: "7-Arrow/dre-backend#490" })).toEqual({ proyecto: "dre", estacion: "In QA", vista: "todo", pr: "7-arrow/dre-backend#490" });
    expect(parseQuery({ proyecto: "../x", vista: "nope", pr: "x" })).toEqual({ proyecto: null, estacion: null, vista: "estacion", pr: null });
  });

  it("keeps the defaults out of the href", () => {
    const q: PjQuery = { proyecto: "dre", estacion: null, vista: "estacion", pr: null };
    expect(pjHref(q)).toBe("/proyectos?proyecto=dre");
    expect(pjHref(q, { estacion: "In Development", vista: "te-tocan" })).toBe("/proyectos?proyecto=dre&estacion=In+Development&vista=te-tocan");
    expect(pjHref({ ...q, proyecto: null })).toBe("/proyectos");
  });

  it("labels lines without the prefix every repo shares, and issues with the project's key", () => {
    expect([...lineLabels(["7-Arrow/dre-backend", "7-Arrow/dre-infra"]).values()]).toEqual(["backend", "infra"]);
    expect([...lineLabels(["a/web", "a/api-server"]).values()]).toEqual(["web", "api-server"]);
    expect(issuePrefixOf(["\\bGHI-(\\d+)\\b"])).toBe("GHI-");
    expect(issuePrefixOf(["^(\\d+)-", "\\(#(\\d+)\\)"])).toBe("");
  });
});

describe("DRE · estación (the default view)", () => {
  it("project tabs with counts, the board path, the sync note and the default station where something is his", () => {
    const s = screen();
    expect(s.tabs.map((t) => [t.label, t.count, t.on])).toEqual([
      ["DRE-RMS-backlog", 26, true],
      ["Prospec", 5, false],
    ]);
    const p = s.project!;
    expect(p.path).toBe("7-Arrow / DRE-RMS-backlog");
    expect(p.boardUrl).toBe("https://github.com/orgs/7-Arrow/projects/2");
    expect(p.sync).toEqual({ limited: false, lead: "Leído de GitHub · ", strong: "hace 2 min", tail: "" });
    // Sin issue holds 5 te tocan; the busiest status station would be In Development.
    expect(p.sel.title).toBe("Sin issue en el board");
  });

  it("In Development: header counts, tabs and rows grouped by issue with every column", () => {
    const p = screen({ estacion: "In Development" }).project!;
    expect(p.sel).toEqual({
      title: "In Development",
      sub: "3 issues con PRs abiertas · 6 PRs · 1 bloqueante tuyo",
      tabs: [
        { key: "estacion", label: "Esta estación", count: 6, href: "/proyectos?estacion=In+Development", on: true },
        { key: "todo", label: "Todo el proyecto", count: 26, href: "/proyectos?estacion=In+Development&vista=todo", on: false },
        { key: "te-tocan", label: "Te tocan", count: 5, href: "/proyectos?estacion=In+Development&vista=te-tocan", on: false },
      ],
    });
    expect(titles(p.blocks)).toEqual(["GHI-471", "GHI-483", "GHI-484"]);
    const g484 = p.blocks[2]!;
    expect(g484).toMatchObject({ kind: "issue", title: "Dispositions: screen fixes after review", interchange: true, meta: "3 PRs · dre-backend + dre-frontend", status: "In Development", statusNone: false });
    const rows = g484.kind === "issue" ? g484.rows : [];
    expect(rows.map((x) => x.number)).toEqual([490, 608, 610]);
    const r608 = rows[1]!;
    expect(r608).toMatchObject({
      repo: "dre-frontend",
      line: "frontend",
      age: "abierta hace 1 día",
      checks: { icon: "ckbad", text: "fallan 1 de 4", strong: true },
      github: { icon: "stop", text: "Cambios pedidos", strong: true },
      tags: [{ kind: "blk", icon: "stop", text: "1 bloqueante" }],
      blocker: true,
      stale: null,
    });
    expect(r608.ticket?.href).toMatch(/^\/tickets\?t=t\d+$/);
    expect(rows[0]!.tags).toEqual([{ kind: "ok", icon: "check", text: "Aprobaste · sin merge" }]);
  });

  it("the band: stations in board order with counts, one line per repo, the interchange ring and the blocker bar", () => {
    const b = screen({ estacion: "In Development" }).project!.band;
    expect(b.lines.map((l) => [l.label, l.quiet])).toEqual([
      ["backend", false],
      ["frontend", false],
      ["infra", false],
      ["connect-intake", true],
    ]);
    const st = b.stations.map((s) => [s.name, s.count, s.on]);
    expect(st[0]).toEqual(["Sin estado", "4 issues · 5 PRs", false]);
    expect(st).toContainEqual(["In Development", "3 issues · 6 PRs", true]);
    expect(st).toContainEqual(["In QA", "1 issue · 1 PR", false]);
    expect(st).toContainEqual(["To-do", "44 issues · sin PRs", false]);
    const xs = b.stations.map((s) => s.x);
    expect([...xs].sort((a, c) => a - c)).toEqual(xs);
    expect(xs[xs.length - 1]!).toBeLessThan(b.W);
    expect(b.stations.find((s) => s.name === "Sin estado")!.dashed).toBe(true);
    const dev = b.stops.find((s) => s.station === "In Development")!;
    expect(dev.dim).toBe(false);
    const ghi484 = dev.stops.find((s) => s.label === "GHI-484")!;
    expect(ghi484.connector).not.toBeNull();
    expect(ghi484.ticks.filter((t) => t.ring)).toHaveLength(2);
    expect(ghi484.ticks.filter((t) => t.blocker)).toHaveLength(1);
    expect(b.stops.find((s) => s.station === "In QA")!.stops[0]!.ticks[0]).toMatchObject({ draft: true, blocker: true });
    expect(b.spur).toMatchObject({ on: false, note: "14 PRs · 5 te tocan" });
    expect(b.spur!.ticks.filter((t) => t.you)).toHaveLength(5);
    expect(b.spur!.more).toEqual(expect.objectContaining({ text: "+4" }));
    expect(b.train).toBeNull();
    expect(b.dotted).toBe(false);
  });
});

describe("Sin issue (the spur)", () => {
  it("te tocan first, capped at 3; each release as one group; what he approved folded", () => {
    const p = screen({ estacion: SIN_ISSUE }).project!;
    expect(p.sel.title).toBe("Sin issue en el board");
    expect(p.sel.sub).toBe("14 PRs que no cuelgan de ninguna issue · 5 te tocan");
    expect(p.sel.tabs.map((t) => [t.label, t.count])).toEqual([
      ["Esta rama", 14],
      ["Todo el proyecto", 26],
      ["Te tocan", 5],
    ]);
    expect(titles(p.blocks)).toEqual(["Te tocan", "Release v1.15.0", "Aprobaste, sin merge"]);
    const [you, rel, ok] = p.blocks as Extract<Block, { kind: "group" }>[];
    expect(you).toMatchObject({ cap: 3, fold: false, more: "2 más que te tocan" });
    expect(you!.rows.map((x) => x.number)).toEqual([439, 452, 492, 546, 61]);
    expect(you!.rows.find((x) => x.number === 61)!.tags).toEqual([{ kind: "plain", icon: "mine", text: "Tuya" }]);
    expect(you!.rows.find((x) => x.number === 452)!.checks).toMatchObject({ icon: "conf", text: "conflictos", sub: "pasan" });
    expect(rel).toMatchObject({ note: "backend #477 + frontend #598 · las dos aprobadas", fold: true, more: "Ver las 2" });
    expect(ok).toMatchObject({ note: "7", fold: true });
    expect(ok!.more).toMatch(/^Ver las 7: /);
    expect(p.band.spur!.on).toBe(true);
    expect(p.band.stops.every((s) => s.dim)).toBe(true);
  });
});

describe("Prospec", () => {
  it("an issue in QA with its PR, a PR with no issue, the release train as one dashed group", () => {
    const p = screen({ proyecto: "prospec" }).project!;
    expect(p.path).toBe("designli / Prospec");
    expect(p.sel.title).toBe("In QA");
    expect(titles(p.blocks)).toEqual(["#219"]);
    const todo = screen({ proyecto: "prospec", vista: "todo" }).project!;
    expect(titles(todo.blocks)).toEqual(["#219", "Sin issue", "Tren a staging", "tren:3 PRs «Create staging PR»"]);
    const train = todo.blocks[3]!;
    expect(train).toMatchObject({ kind: "train", prs: [{ label: "backend #3" }, { label: "frontend #2" }, { label: "admin #1" }] });
    expect(p.band.train).toMatchObject({ on: false, note: "3 PRs del bot, una por repo" });
    expect(p.band.train!.labelX).toBeGreaterThan(p.band.spur!.noteX);
    expect(screen({ proyecto: "prospec", estacion: TREN }).project!.sel.title).toBe("Tren a staging");
  });

  it("a project with no open PRs: Nada abierto, the board's busiest stations and links out", () => {
    const p = screen({ proyecto: "prospec" }, { emptyProspec: true }).project!;
    expect(p.sel).toEqual({ title: "Nada abierto", sub: "0 PRs en prospec-backend, prospec-frontend y prospec-admin", tabs: [] });
    expect(p.empty).toEqual({
      title: "Prospec no tiene PRs abiertas.",
      text: "El board sigue: 64 issues en Ready for UAT y 36 en Todo.",
      actions: [
        { label: "Abrir el board en GitHub", href: "https://github.com/orgs/designli/projects/45", external: true },
        { label: "Ver DRE-RMS-backlog · 26", href: "/proyectos?proyecto=dre", external: false },
      ],
    });
    expect(p.blocks).toEqual([]);
    expect(p.band.empty).toBe(true);
    expect(p.band.legend).toBe(false);
  });
});

describe("GitHub limitado (Estados B)", () => {
  it("says until when, keeps the last good read on every row and dots the lines", () => {
    const p = screen({ estacion: "In Development" }, { limited: true }).project!;
    expect(p.sync).toMatchObject({ limited: true, lead: "GitHub en pausa hasta las ", strong: "11:05" });
    expect(p.sync.tail).toMatch(/^ · lo que ves es de las \d\d:\d\d$/);
    expect(p.band.dotted).toBe(true);
    const rows = blockRows(p.blocks);
    expect(rows).toHaveLength(6);
    expect(rows.every((x) => /^Dato de las \d\d:\d\d$/.test(x.stale ?? ""))).toBe(true);
    expect(rows.find((x) => x.number === 608)!.checks.text).toBe("fallan 1 de 4");
  });
});

describe("many PRs", () => {
  it("caps a group's rows, the list's groups and the band's stops", () => {
    const p = screen({ estacion: "In Development" }, { many: true }).project!;
    expect(p.blocks.length).toBeGreaterThan(p.capBlocks);
    expect(p.moreBlocks).toBe(`Ver ${p.blocks.length - p.capBlocks} grupos más`);
    const g = p.blocks.find((b) => b.kind === "issue" && b.label === "GHI-484")!;
    expect(g.kind === "issue" && g.rows.length).toBe(9);
    expect(g).toMatchObject({ cap: 5, more: "4 más" });
    const dev = p.band.stops.find((s) => s.station === "In Development")!;
    expect(dev.more?.text).toMatch(/^\+\d+$/);
    const last = dev.stops[dev.stops.length - 1]!;
    expect(last.x).toBeLessThan(p.band.W);
  });
});

describe("phone", () => {
  it("station tabs with PRs, the corridor of the selected one and one PR full screen", () => {
    const p = screen({ estacion: "In Development", pr: "7-arrow/dre-frontend#608" }).project!;
    expect(p.phone.stations.map((t) => [t.label, t.count, t.on])).toEqual([
      ["Sin estado", 5, false],
      ["In Development", 6, true],
      ["In QA", 1, false],
      ["Sin issue", 14, false],
    ]);
    expect(p.phone.corridor).toMatchObject({ name: "In Development", prev: { name: "Sin estado" }, next: { name: "In QA" } });
    expect(p.phone.corridor!.stops.map((s) => s.label)).toEqual(["GHI-471", "GHI-483", "GHI-484"]);
    expect(p.phone.detail).toMatchObject({
      back: { label: "In Development", href: "/proyectos?estacion=In+Development" },
      pos: "5 de 6",
      kind: "dre-frontend · PR #608",
      title: "Disposition screen fixes: module-off gating (GHI-484)",
      by: "jrodriguez · abierta hace 1 día · hacia develop",
      url: "https://github.com/7-Arrow/dre-frontend/pull/608",
      issue: { label: "GHI-484", status: "In Development", interchange: true, siblings: "Va con backend #490 y frontend #610" },
    });
    const [blk, ck] = p.phone.detail!.estado;
    expect(blk).toMatchObject({ icon: "stop", title: "1 bloqueante abierto en tu review", quote: { at: "disposition.constant.ts:79" } });
    expect(ck).toMatchObject({ icon: "ckbad", title: "Checks fallan · cambios pedidos", text: "1 de 4 · sin conflictos" });
    expect(p.phone.detail!.tickets).toHaveLength(1);
    expect(p.phone.detail!.tickets[0]).toMatchObject({ title: "Review dre-frontend#608", status: "abierto" });
    const rows = blockRows(p.blocks);
    expect(rows.filter((x) => x.selected).map((x) => x.number)).toEqual([608]);
  });

  it("no corridor on Sin issue", () => {
    expect(screen({ estacion: SIN_ISSUE }).project!.phone.corridor).toBeNull();
  });
});
