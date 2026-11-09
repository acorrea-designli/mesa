// GET /api/semana: zod-validated params, the week and project filter, the plain-text copy.
import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/semana/route";
import { openDb } from "../db/sqlite";
import { loadSemana } from "@/features/semana/read";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
const T0 = new Date("2026-11-03T10:00:00.000Z");
const get = (qs = "") => GET(new Request(`http://local/api/semana${qs}`), { params: Promise.resolve({}) });

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" }, T0);
  const seed: [string, string, string][] = [
    ["Uno", "dre-frontend", "2026-11-10T15:00:00.000Z"],
    ["Dos", "mesa", "2026-11-11T15:00:00.000Z"],
    ["Vieja", "mesa", "2026-11-03T15:00:00.000Z"],
  ];
  for (const [title, project, closedAt] of seed) {
    const t = r.tickets.create({ direction: "andres_asks", title, ownerSession: "lead", project }, T0);
    r.db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?").run(closedAt, t.id);
  }
});

describe("GET /api/semana", () => {
  it("returns a past week grouped by client, with a bar per project and the copy text", async () => {
    const res = await get("?semana=2026-11-09");
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.week).toMatchObject({ monday: "2026-11-09", prev: "2026-11-02" });
    expect(d.projects).toEqual([
      { name: "DRE Central", count: 1 },
      { name: "Mesa", count: 1 },
    ]);
    expect(d.total).toBe(2);
    expect(d.text).toContain("DRE Central");
  });

  it("filters by project and ignores an unknown one", async () => {
    const one = await (await get("?semana=2026-11-09&proyecto=Mesa")).json();
    expect(one.project).toBe("Mesa");
    expect(one.groups.map((x: { name: string }) => x.name)).toEqual(["Mesa"]);
    expect(one.projects).toHaveLength(2); // the project bars keep the whole week's counts
    expect(one.text).not.toContain("DRE Central");
    const unknown = await (await get("?semana=2026-11-09&proyecto=Nada")).json();
    expect(unknown.project).toBeNull();
    expect(unknown.groups).toHaveLength(2);
  });

  it("an earlier week has its own work", async () => {
    const d = await (await get("?semana=2026-11-02")).json();
    expect(d.groups.map((x: { name: string }) => x.name)).toEqual(["Mesa"]);
  });

  it("an empty week has no groups and no text", async () => {
    const d = await (await get("?semana=2026-10-05")).json();
    expect(d).toMatchObject({ groups: [], total: 0, text: "" });
  });

  it("a day narrows the list and the bars but not the day columns; a day outside the week or not yet happened is ignored", () => {
    const now = new Date("2026-11-11T20:00:00.000Z"); // Wed 11 Nov, 15:00 Bogota
    const d = loadSemana(r, { semana: "2026-11-09", dia: "2026-11-10" }, now);
    expect(d.day).toMatchObject({ key: "2026-11-10" });
    expect(d.groups.map((x) => x.name)).toEqual(["DRE Central"]);
    expect(d.projects).toEqual([{ name: "DRE Central", count: 1 }]);
    expect(d.days.map((x) => x.count)).toEqual([0, 1, 1, 0, 0, 0, 0]);
    expect(d.days.find((x) => x.selected)?.href).toBe("/semana"); // current week and whole-week back link stay out of the query
    expect(d.text.split(String.fromCharCode(10))[0]).toMatch(/^Día /);
    expect(d.showTime).toBe(true);
    expect(loadSemana(r, { semana: "2026-11-09", dia: "2026-11-03" }, now).day).toBeNull();
    expect(loadSemana(r, { semana: "2026-11-09", dia: "2026-11-13" }, now).day).toBeNull();
  });

  it("the hero and the rail share one number: today's total from the same function", () => {
    const now = new Date("2026-11-11T20:00:00.000Z");
    const d = loadSemana(r, { semana: "2026-11-09" }, now);
    expect(d.total).toBe(2);
    expect(d.todayCount).toBe(1);
    expect(d.todayCount).toBe(r.week.doneToday(now));
    expect(loadSemana(r, { semana: "2026-11-02" }, now).todayCount).toBeNull();
  });

  it("400 on a malformed week", async () => {
    expect((await get("?semana=ayer")).status).toBe(400);
    expect((await get("?proyecto=")).status).toBe(400);
  });
});
