import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allRepos, loadProjects, parseProjects, PROJECTS_CONFIG } from "./projects-config";

const tmp = (files: Record<string, unknown>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-projects-"));
  for (const [name, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof v === "string" ? v : JSON.stringify(v));
  return path.join(dir, "projects.json");
};

describe("config/projects.json", () => {
  it("the tracked file maps DRE and Prospec to their boards, Status order and repos", () => {
    const { projects, error } = loadProjects(PROJECTS_CONFIG);
    expect(error).toBeNull();
    expect(projects.map((p) => [p.key, p.name, `${p.board.owner}/${p.board.number}`])).toEqual([
      ["dre", "DRE-RMS-backlog", "7-Arrow/2"],
      ["prospec", "Prospec", "designli/45"],
    ]);
    const [dre, prospec] = projects;
    expect(dre!.repos).toEqual(["7-Arrow/dre-backend", "7-Arrow/dre-frontend", "7-Arrow/dre-infra", "7-Arrow/dre-connect-intake"]);
    expect(prospec!.repos).toEqual(["designli/prospec-backend", "designli/prospec-frontend", "designli/prospec-admin"]);
    expect(dre!.statusOrder[0]).toBe("Blocked");
    expect(prospec!.issueRepo).toBe("designli/prospec-backlog");
    expect(dre!.boardUrl).toBe("https://github.com/orgs/7-Arrow/projects/2");
    expect(allRepos(projects)).toHaveLength(7);
  });

  it("merges projects.local.json over it the way sweep.local.json is merged (objects by key, arrays replace)", () => {
    const file = tmp({
      "projects.json": { projects: { a: { name: "A", board: { owner: "o", number: 1 }, repos: ["o/r1", "o/r2"], statusOrder: ["X", "Y"] } } },
      "projects.local.json": { projects: { a: { repos: ["o/r3"] }, b: { name: "B", board: { owner: "u", number: 2, ownerType: "user" }, repos: ["u/r"] } } },
    });
    const { projects, error } = loadProjects(file);
    expect(error).toBeNull();
    expect(projects.map((p) => [p.key, p.name, p.repos, p.statusOrder])).toEqual([
      ["a", "A", ["o/r3"], ["X", "Y"]],
      ["b", "B", ["u/r"], []],
    ]);
    expect(projects[1]!.boardUrl).toBe("https://github.com/users/u/projects/2");
  });

  it("an invalid or missing file gives no projects and the reason, never a half-read map", () => {
    expect(loadProjects(tmp({ "projects.json": "{ nope" })).projects).toEqual([]);
    expect(loadProjects(path.join(os.tmpdir(), "mesa-missing", "projects.json")).error).toBeTruthy();
    // Names reach GraphQL documents and REST paths as text: anything but owner/name characters is refused.
    for (const repos of [["o/r\" } mutation {"], ["o"], ["o/r/x"], ["o/r?state=all"]]) {
      expect(() => parseProjects({ projects: { a: { name: "A", board: { owner: "o", number: 1 }, repos } } })).toThrow();
    }
    expect(() => parseProjects({ projects: { a: { name: "A", board: { owner: "o\"", number: 1 }, repos: ["o/r"] } } })).toThrow();
    expect(() => parseProjects({ projects: { a: { name: "A", board: { owner: "o", number: 1 }, repos: ["o/r"], issueKeys: ["(unclosed"] } } })).toThrow();
  });
});
