import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate, openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { STATIONS } from "../domain/types";
import {
  ensureProject,
  guardProjectGh,
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

  it("creates a draft with the PR URL as plain text in the body when the task links a GitHub PR", async () => {
    const { item } = r.items.upsert({
      source: "github",
      externalId: "pr:acme/api#7",
      kind: "pr_review",
      title: "api#7",
      url: "https://github.com/acme/api/pull/7",
    });
    const t = r.tasks.create({ title: "api#7", source: "github", project: "acme/api", excerpt: "Review pedido", itemIds: [item.id] });
    const gh = fakeGh(
      (a) => (is("project", "item-create")(a) ? ok({ id: "PVTI_draft" }) : undefined),
      (a) => (is("project", "item-edit")(a) ? ok({}) : undefined),
    );
    await pushPending(r, gh.run, P);
    const create = gh.calls[0]!.args;
    expect(create.slice(0, 2)).toEqual(["project", "item-create"]);
    expect(create[create.indexOf("--title") + 1]).toBe("api#7");
    expect(create[create.indexOf("--body") + 1]).toBe(
      `Review pedido\n\nProyecto: acme/api\n\nGitHub: https://github.com/acme/api/pull/7\n\nMesa: ${t.id}`,
    );
    expect(gh.calls.some((c) => c.args.includes("item-add") || c.args.includes("--url"))).toBe(false);
    expect(r.tasks.get(t.id)).toMatchObject({ syncState: "synced", ghItemId: "PVTI_draft", ghContentUrl: null });
  });

  it("links an issue the same way: a draft, URL in the body", async () => {
    const { item } = r.items.upsert({ source: "github", externalId: "issue:acme/api#9", kind: "mention", title: "api#9", url: "https://github.com/acme/api/issues/9" });
    r.tasks.create({ title: "api#9", source: "github", itemIds: [item.id] });
    const gh = fakeGh(
      (a) => (is("project", "item-create")(a) ? ok({ id: "PVTI_i" }) : undefined),
      (a) => (is("project", "item-edit")(a) ? ok({}) : undefined),
    );
    await pushPending(r, gh.run, P);
    expect(gh.calls[0]!.args[gh.calls[0]!.args.indexOf("--body") + 1]).toContain("GitHub: https://github.com/acme/api/issues/9");
    expect(gh.calls.some((c) => c.args.includes("item-add"))).toBe(false);
  });

  it("never edits a content-linked item a task still holds: it gets a fresh draft", async () => {
    const t = r.tasks.create({ title: "viejo", source: "github" });
    r.tasks.markSync(t.id, { syncState: "pending", ghItemId: "PVTI_pr", ghContentUrl: "https://github.com/acme/api/pull/7" });
    const gh = fakeGh(
      (a) => (is("project", "item-create")(a) ? ok({ id: "PVTI_new" }) : undefined),
      (a) => (is("project", "item-edit")(a) ? ok({}) : undefined),
    );
    await pushPending(r, gh.run, P);
    expect(gh.calls.some((c) => c.args.includes("PVTI_pr"))).toBe(false);
    expect(r.tasks.get(t.id)).toMatchObject({ syncState: "synced", ghItemId: "PVTI_new", ghContentUrl: null });
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
      { id: "D", status: "Todo", title: "New in GitHub", content: { type: "DraftIssue" } },
      { id: "E", status: "Inbox", content: { type: "DraftIssue" } },
      { id: "F", status: "Todo", title: "Client PR", content: { type: "PullRequest", url: "https://github.com/acme/api/pull/7" } },
      { id: "G", status: "Todo", title: "Client issue", content: { type: "Issue", url: "https://github.com/acme/api/issues/9" } },
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
    expect(plan.skipped).toEqual(["F", "G"]);
  });

  it("pulls only drafts: PR and issue items added by hand are counted, recorded as known, never imported or edited", async () => {
    const items = [
      { id: "PVTI_draft", status: "Todo", title: "Borrador", content: { type: "DraftIssue", body: "nota" } },
      { id: "PVTI_pr", status: "Todo", title: "Client PR", content: { type: "PullRequest", url: "https://github.com/acme/api/pull/7", repository: "https://github.com/acme/api" } },
      { id: "PVTI_issue", status: "Done", title: "Client issue", content: { type: "Issue", url: "https://github.com/acme/api/issues/9" } },
    ];
    const gh = fakeGh((a) => (is("project", "item-list")(a) ? ok({ items }) : undefined));
    expect(await pullProject(r, gh.run, P)).toEqual({ moved: 0, imported: 1, kept: 0, skipped: 2 });
    expect(r.tasks.list().map((x) => x.ghItemId)).toEqual(["PVTI_draft"]);
    expect(r.tasks.list().every((x) => x.ghContentUrl === null)).toBe(true);
    expect(JSON.parse(r.db.prepare("SELECT value FROM settings WHERE key = 'gh_project.known_items'").get()!.value as string)).toEqual(
      expect.arrayContaining(["PVTI_pr", "PVTI_issue", "PVTI_draft"]),
    );
    // Not retried on the next pull, and Mesa wrote nothing to GitHub.
    expect(await pullProject(r, gh.run, P)).toEqual({ moved: 0, imported: 0, kept: 0, skipped: 0 });
    expect(gh.calls.every((c) => c.args[1] === "item-list")).toBe(true);
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
    expect(await pullProject(r, gh.run, P)).toEqual({ moved: 1, imported: 1, kept: 0, skipped: 0 });
    expect(r.tasks.get(t.id)).toMatchObject({ station: "waiting", syncState: "synced" });
    expect(r.items.get(item.id).station).toBe("waiting");
    const imported = r.tasks.list().find((x) => x.ghItemId === "PVTI_new")!;
    expect(imported).toMatchObject({ title: "Desde GitHub", station: "doing", syncState: "synced", excerpt: "hola" });

    // Deleted in Mesa: never re-imported.
    r.tasks.remove(imported.id);
    expect((await pullProject(r, gh.run, P)).imported).toBe(0);
  });
});

describe("drafts only guard", () => {
  let r: Repos;
  beforeEach(() => {
    r = createRepos(openDb(":memory:"));
  });

  it("refuses `project item-add` before gh runs", async () => {
    const gh = fakeGh(() => ok({ id: "x" }));
    const guarded = guardProjectGh(gh.run);
    await expect(guarded(["project", "item-add", "3", "--owner", OWNER, "--url", "https://github.com/acme/api/pull/7"])).rejects.toThrow(/item-add/);
    expect(gh.calls).toHaveLength(0);
  });

  it("refuses a GraphQL body (stdin or argument) naming addProjectV2ItemById or linkProjectV2*", async () => {
    const gh = fakeGh(() => ok({ data: {} }));
    const guarded = guardProjectGh(gh.run);
    const mutation = "mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }";
    await expect(guarded(["api", "graphql", "--input", "-"], { input: JSON.stringify({ query: mutation }) })).rejects.toThrow(/addProjectV2ItemById/);
    await expect(guarded(["api", "graphql", "-f", `query=${mutation}`])).rejects.toThrow(/addProjectV2ItemById/);
    await expect(guarded(["api", "graphql", "--input", "-"], { input: JSON.stringify({ query: "mutation { linkProjectV2ToRepository(input: {}) { clientMutationId } }" }) })).rejects.toThrow(/linkProjectV2/);
    expect(gh.calls).toHaveLength(0);
  });

  it("scans only the GraphQL document: a draft's title and body, and a variable value, may name the mutations", async () => {
    const gh = fakeGh(() => ok({ id: "x" }));
    const guarded = guardProjectGh(gh.run);
    const text = "Card about addProjectV2ItemById and linkProjectV2ToRepository";
    await guarded(["project", "item-create", "3", "--owner", OWNER, "--title", text, "--body", `${text}\nhttps://github.com/acme/api/pull/7`]);
    await guarded(["api", "graphql", "--input", "-"], { input: JSON.stringify({ query: "query($t: String!) { viewer { login } }", variables: { t: text } }) });
    await guarded(["api", "graphql", "-f", "query=query { viewer { login } }", "-f", `note=${text}`, "-F", `t=${text}`]);
    expect(gh.calls).toHaveLength(3);
  });

  it("refuses a query= field in every spelling, and a batch with one bad document", async () => {
    const gh = fakeGh(() => ok({ data: {} }));
    const guarded = guardProjectGh(gh.run);
    const m = "mutation { addProjectV2ItemById(input: {}) { clientMutationId } }";
    for (const extra of [["-F", `query=${m}`], ["--raw-field", `query=${m}`], ["--field", `query=${m}`], ["-fquery=" + m], [`--raw-field=query=${m}`]]) {
      await expect(guarded(["api", "graphql", ...extra])).rejects.toThrow(/addProjectV2ItemById/);
    }
    await expect(guarded(["api", "graphql", "--input", "-"], { input: JSON.stringify([{ query: "{ viewer { login } }" }, { query: m }]) })).rejects.toThrow(/addProjectV2ItemById/);
    expect(gh.calls).toHaveLength(0);
  });

  it("stdin that is not JSON is scanned whole (fail safe)", async () => {
    const gh = fakeGh(() => ok({}));
    const guarded = guardProjectGh(gh.run);
    await expect(guarded(["api", "graphql", "--input", "-"], { input: "mutation { linkProjectV2ToTeam(input: {}) { clientMutationId } }" })).rejects.toThrow(/linkProjectV2/);
    await expect(guarded(["api", "graphql", "--input", "-"], { input: '"addProjectV2ItemById"' })).rejects.toThrow(/addProjectV2ItemById/);
    expect(gh.calls).toHaveLength(0);
  });

  it("lets the draft, field and list calls through", async () => {
    const gh = fakeGh(() => ok({}));
    const guarded = guardProjectGh(gh.run);
    await guarded(["project", "item-create", "3", "--title", "t"]);
    await guarded(["project", "item-edit", "--id", "I"]);
    await guarded(["api", "graphql", "--input", "-"], { input: JSON.stringify({ query: "mutation { updateProjectV2Field(input: {}) { clientMutationId } }" }) });
    expect(gh.calls).toHaveLength(3);
  });

  it("push, pull and ensure run behind the guard: a runner-level item-add never reaches gh", async () => {
    const t = r.tasks.create({ title: "x", source: "claude" });
    const gh = fakeGh(
      (a) => (is("project", "item-create")(a) ? ok({ id: "PVTI_1" }) : undefined),
      (a) => (is("project", "item-edit")(a) ? ok({}) : undefined),
    );
    await pushPending(r, gh.run, P);
    expect(r.tasks.get(t.id).syncState).toBe("synced");
    expect(gh.calls.every((c) => !c.args.includes("item-add"))).toBe(true);
  });

  it("no source file under src/ calls item-add or addProjectV2ItemById (the guard in github-project.ts only names them)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\.(ts|tsx|mjs)$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(process.cwd(), "src"));
    const offenders = files.filter((f) => {
      const text = fs.readFileSync(f, "utf8");
      if (path.basename(f) === "github-project.ts") return /\[[^\]]*"item-add"/.test(text) || /mutation[^`]*(addProjectV2ItemById|linkProjectV2)/.test(text);
      return /item-add|addProjectV2ItemById|linkProjectV2/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});

describe("migration 0320: legacy content links", () => {
  it("clears gh_item_id and gh_content_url and re-queues tasks that held a content-linked item; drafts are untouched", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-"));
    for (const f of fs.readdirSync(MIGRATIONS_DIR)) if (f !== "0320_project_drafts_only.sql") fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    migrate(db, dir);
    const old = createRepos(db);
    const linked = old.tasks.create({ title: "PR enlazada", source: "github", station: "done" });
    old.tasks.markSync(linked.id, { syncState: "synced", ghItemId: "PVTI_pr", ghContentUrl: "https://github.com/acme/api/pull/7" });
    const failed = old.tasks.create({ title: "PR con error", source: "github" });
    old.tasks.markSync(failed.id, { syncState: "error", syncError: "boom", ghItemId: "PVTI_pr2", ghContentUrl: "https://github.com/acme/api/pull/8" });
    const draft = old.tasks.create({ title: "Borrador", source: "claude" });
    old.tasks.markSync(draft.id, { syncState: "synced", ghItemId: "PVTI_draft", ghContentUrl: null });

    expect(migrate(db)).toEqual(["0320_project_drafts_only.sql"]);
    expect(old.tasks.get(linked.id)).toMatchObject({ ghItemId: null, ghContentUrl: null, syncState: "pending", station: "done" });
    expect(old.tasks.get(failed.id)).toMatchObject({ ghItemId: null, ghContentUrl: null, syncState: "pending", syncError: null });
    expect(old.tasks.get(draft.id)).toMatchObject({ ghItemId: "PVTI_draft", ghContentUrl: null, syncState: "synced" });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
