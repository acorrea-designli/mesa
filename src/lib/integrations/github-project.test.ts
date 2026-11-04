import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { STATIONS } from "../domain/types";
import {
  ensureProject,
  planPull,
  pullProject,
  pushPending,
  readProjectSettings,
  stationToStatus,
  statusToStation,
  type GhProjectItem,
  type ProjectSettings,
} from "./github-project";
import { fakeGh, ok, type Handler } from "./test/fake-gh";

const OWNER = "acorrea-designli";
const OPTIONS = { Inbox: "o1", Todo: "o2", "In Progress": "o3", Waiting: "o4", Done: "o5" };
const P: ProjectSettings = {
  id: "PVT_1",
  number: 3,
  url: "https://github.com/users/acorrea-designli/projects/3",
  owner: OWNER,
  statusFieldId: "F1",
  statusOptions: OPTIONS,
};
const is = (...head: string[]) => (a: string[]) => head.every((h, i) => a[i] === h);

describe("station <-> Status mapping", () => {
  it("round-trips every station", () => {
    for (const s of STATIONS) expect(statusToStation(stationToStatus(s))).toBe(s);
    expect(stationToStatus("doing")).toBe("In Progress");
    expect(statusToStation("in progress")).toBe("doing");
    expect(statusToStation("Backlog")).toBe("inbox");
    expect(statusToStation(null)).toBeNull();
    expect(statusToStation("Something else")).toBeNull();
  });
});

describe("ensureProject", () => {
  let r: Repos;
  beforeEach(() => {
    r = createRepos(openDb(":memory:"));
  });

  const fields =
    (options: { id: string; name: string }[]): Handler =>
    (a) =>
      is("project", "field-list")(a) ? ok({ fields: [{ id: "F1", name: "Status", type: "ProjectV2SingleSelectField", options }], totalCount: 1 }) : undefined;

  it("creates the Project only when missing and adds the missing Status options keeping ids", async () => {
    const gh = fakeGh(
      (a) => (is("project", "list")(a) ? ok({ projects: [{ id: "PVT_x", number: 1, title: "Other", url: "u" }], totalCount: 1 }) : undefined),
      (a) => (is("project", "create")(a) ? ok({ id: "PVT_1", number: 3, title: "Mesa", url: P.url }) : undefined),
      fields([
        { id: "t", name: "Todo" },
        { id: "p", name: "In Progress" },
        { id: "d", name: "Done" },
      ]),
      (a, input) => {
        if (!is("api", "graphql")(a)) return undefined;
        const v = JSON.parse(input!).variables as { opts: { id?: string; name: string }[] };
        return ok({ data: { updateProjectV2Field: { projectV2Field: { options: v.opts.map((o, i) => ({ id: o.id ?? `new${i}`, name: o.name })) } } } });
      },
    );
    const res = await ensureProject(r.db, gh.run, OWNER);
    expect(res.created).toBe(true);
    const sent = JSON.parse(gh.calls.find((c) => c.args[1] === "graphql")!.input!).variables.opts as { id?: string; name: string }[];
    expect(sent.map((o) => o.name)).toEqual(["Inbox", "Todo", "In Progress", "Waiting", "Done"]);
    expect(sent[1]).toMatchObject({ id: "t" });
    expect(readProjectSettings(r.db)).toEqual({
      id: "PVT_1",
      number: 3,
      url: P.url,
      owner: OWNER,
      statusFieldId: "F1",
      statusOptions: { Inbox: "new0", Todo: "t", "In Progress": "p", Waiting: "new3", Done: "d" },
    });
  });

  it("reuses an existing Project and does not touch complete options", async () => {
    const gh = fakeGh(
      (a) => (is("project", "list")(a) ? ok({ projects: [{ id: "PVT_1", number: 3, title: "Mesa", url: P.url }], totalCount: 1 }) : undefined),
      fields(Object.entries(OPTIONS).map(([name, id]) => ({ id, name }))),
    );
    const res = await ensureProject(r.db, gh.run, OWNER);
    expect(res.created).toBe(false);
    expect(gh.calls.some((c) => c.args[1] === "create" || c.args[1] === "graphql")).toBe(false);
    expect(res.project.statusOptions).toEqual(OPTIONS);
  });
});

describe("push and pull", () => {
  let r: Repos;
  beforeEach(() => {
    r = createRepos(openDb(":memory:"));
  });

  it("pushes pending tasks, sets Status and acks with synced; skips samples", async () => {
    const t = r.tasks.create({ title: "Revisar contrato", source: "basecamp", station: "todo", excerpt: "Cliente pide cambios" });
    const sample = r.tasks.create({ title: "Muestra", source: "slack", isSample: true });
    const gh = fakeGh(
      (a) => (is("project", "item-create")(a) ? ok({ id: "PVTI_1" }) : undefined),
      (a) => (is("project", "item-edit")(a) ? ok({ id: "PVTI_1" }) : undefined),
    );
    const res = await pushPending(r, gh.run, P);
    expect(res).toMatchObject({ pushed: 1, failed: 0 });
    const edit = gh.calls.find((c) => c.args[1] === "item-edit")!.args;
    expect(edit).toEqual(expect.arrayContaining(["--id", "PVTI_1", "--project-id", "PVT_1", "--field-id", "F1", "--single-select-option-id", "o2"]));
    expect(r.tasks.get(t.id)).toMatchObject({ syncState: "synced", ghItemId: "PVTI_1" });
    expect(r.tasks.get(sample.id).syncState).toBe("pending");

    // A later move only edits the Status of the existing item.
    r.tasks.move(t.id, "doing");
    expect(r.tasks.get(t.id).syncState).toBe("pending");
    await pushPending(r, gh.run, P);
    expect(gh.calls.filter((c) => c.args[1] === "item-create")).toHaveLength(1);
    expect(gh.calls.at(-1)!.args).toContain("o3");
    expect(r.tasks.get(t.id).syncState).toBe("synced");
  });

  it("adds a PR as the item content when the task links a GitHub PR", async () => {
    const { item } = r.items.upsert({
      source: "github",
      externalId: "pr:acme/api#7",
      kind: "pr_review",
      title: "api#7",
      url: "https://github.com/acme/api/pull/7",
    });
    r.tasks.create({ title: "api#7", source: "github", itemIds: [item.id] });
    const gh = fakeGh(
      (a) => (is("project", "item-add")(a) ? ok({ id: "PVTI_pr" }) : undefined),
      (a) => (is("project", "item-edit")(a) ? ok({}) : undefined),
    );
    await pushPending(r, gh.run, P);
    expect(gh.calls[0]!.args).toEqual(expect.arrayContaining(["--url", "https://github.com/acme/api/pull/7"]));
  });

  it("marks a task error on a failed write", async () => {
    const t = r.tasks.create({ title: "x", source: "claude" });
    const gh = fakeGh((a) => (is("project", "item-create")(a) ? { code: 1, stdout: "", stderr: "GraphQL: something broke" } : undefined));
    const res = await pushPending(r, gh.run, P);
    expect(res.failed).toBe(1);
    expect(r.tasks.get(t.id)).toMatchObject({ syncState: "error", syncError: "GraphQL: something broke" });
  });

  it("stops the round without marking tasks on a missing project scope", async () => {
    const t = r.tasks.create({ title: "x", source: "claude" });
    const gh = fakeGh(() => ({ code: 1, stdout: "", stderr: "your authentication token is missing required scopes [project]" }));
    await expect(pushPending(r, gh.run, P)).rejects.toMatchObject({ kind: "scope" });
    expect(r.tasks.get(t.id).syncState).toBe("pending");
  });

  it("plans pull: remote moves apply to synced tasks; a pending local move wins", () => {
    const items: GhProjectItem[] = [
      { id: "A", status: "Done" },
      { id: "B", status: "Waiting" },
      { id: "C", status: "Todo" },
      { id: "D", status: "Todo", title: "New in GitHub" },
      { id: "E", status: "Inbox" },
    ];
    const tasks = [
      { id: "ta", ghItemId: "A", station: "doing" as const, syncState: "synced" as const, isSample: false },
      { id: "tb", ghItemId: "B", station: "todo" as const, syncState: "pending" as const, isSample: false },
      { id: "tc", ghItemId: "C", station: "todo" as const, syncState: "synced" as const, isSample: false },
    ];
    const plan = planPull(items, tasks, new Set(["E"]));
    expect(plan.moves).toEqual([{ taskId: "ta", station: "done" }]);
    expect(plan.kept).toBe(1);
    expect(plan.imports.map((i) => i.item.id)).toEqual(["D"]);
  });

  it("pulls: moves a synced task and its items, imports a new item once", async () => {
    const { item } = r.items.upsert({ source: "slack", externalId: "slack:C1:1", kind: "message", title: "m" });
    const t = r.tasks.create({ title: "t", source: "slack", station: "todo", itemIds: [item.id] });
    r.tasks.markSync(t.id, { syncState: "synced", ghItemId: "PVTI_t" });
    const gh = fakeGh((a) =>
      is("project", "item-list")(a)
        ? ok({
            items: [
              { id: "PVTI_t", status: "Waiting" },
              { id: "PVTI_new", status: "In Progress", title: "Desde GitHub", content: { type: "DraftIssue", body: "hola" } },
            ],
          })
        : undefined,
    );
    expect(await pullProject(r, gh.run, P)).toEqual({ moved: 1, imported: 1, kept: 0 });
    expect(r.tasks.get(t.id)).toMatchObject({ station: "waiting", syncState: "synced" });
    expect(r.items.get(item.id).station).toBe("waiting");
    const imported = r.tasks.list().find((x) => x.ghItemId === "PVTI_new")!;
    expect(imported).toMatchObject({ title: "Desde GitHub", station: "doing", syncState: "synced", excerpt: "hola" });

    // Deleted in Mesa: never re-imported.
    r.tasks.remove(imported.id);
    expect((await pullProject(r, gh.run, P)).imported).toBe(0);
  });
});
