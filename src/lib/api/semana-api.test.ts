// GET /api/semana: zod-validated params, the week and project filter, the plain-text copy.
import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/semana/route";
import { openDb } from "../db/sqlite";
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
  it("returns a past week grouped by client, with a chip per project and the copy text", async () => {
    const res = await get("?semana=2026-11-09");
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.week).toMatchObject({ monday: "2026-11-09", prev: "2026-11-02" });
    expect(d.chips).toEqual([
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
    expect(one.chips).toHaveLength(2); // chips keep the whole week's counts
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

  it("400 on a malformed week", async () => {
    expect((await get("?semana=ayer")).status).toBe(400);
    expect((await get("?proyecto=")).status).toBe(400);
  });
});
