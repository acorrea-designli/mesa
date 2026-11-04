import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { matchesIgnored, projectKey } from "../domain/ignore";
import type { Source } from "../domain/types";
import { createRepos, type Repos } from ".";
import { lastInteractionAt } from "./interaction";

const T0 = new Date("2026-11-03T15:00:00Z");

let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
});

const item = (source: Source, externalId: string, project: string, extra: Record<string, unknown> = {}) =>
  r.items.create({ source, externalId, kind: "k", title: `${source} ${externalId}`, project, ...extra }, T0);

describe("projectKey", () => {
  const cases: [Source, string, string, string][] = [
    ["github", "pr:designli/prospec-admin#212", "prospec-admin", "designli/prospec-admin"],
    ["github", "sample:pr:example-org/scout#7", "scout", "example-org/scout"],
    ["github", "issue:42", "scout", "scout"],
    ["github", "pr:#5", "scout", "scout"],
    ["slack", "C0123ABC:1730640000.000100", "#deploys", "C0123ABC"],
    ["slack", "sample:slack:C09:1.2", "#x", "C09"],
    ["slack", ":1.2", "#x", "#x"],
    ["slack", "noколон", "#x", "#x"],
    ["basecamp", "5001#9", "Freightmate", "Freightmate"],
    ["claude", "q1", "bseen", "bseen"],
  ];

  it.each(cases)("%s %s -> %s", (source, externalId, project, key) => {
    expect(projectKey({ source, externalId, project })).toBe(key);
  });

  it("matches the generated column items.project_key", () => {
    for (const [source, externalId, project, key] of cases) {
      const it = item(source, externalId, project);
      expect(it.projectKey).toBe(key);
    }
  });

  it("matches by key or plain project, per source or for every source", () => {
    const rows = [
      { source: "github" as const, project: "designli/prospec-admin" },
      { source: "*" as const, project: "freightmate" },
    ];
    expect(matchesIgnored(rows, { source: "github", key: "designli/prospec-admin", project: "prospec-admin" })).toBe(true);
    expect(matchesIgnored(rows, { source: "slack", key: "designli/prospec-admin", project: "" })).toBe(false);
    expect(matchesIgnored(rows, { source: "basecamp", key: "freightmate", project: "freightmate" })).toBe(true);
    expect(matchesIgnored(rows, { source: "claude", key: "bseen", project: "bseen" })).toBe(false);
  });
});

describe("ignored projects repo", () => {
  it("adds idempotently, lists, removes, and stamps lastInteractionAt", () => {
    const a = r.ignored.add({ source: "github", project: " designli/prospec-admin ", label: "prospec-admin" }, T0);
    expect(a.created).toBe(true);
    expect(a.ignored).toMatchObject({ source: "github", project: "designli/prospec-admin", label: "prospec-admin" });
    expect(lastInteractionAt(r.db)).toBe(T0.toISOString());
    const again = r.ignored.add({ source: "github", project: "designli/prospec-admin" }, T0);
    expect(again).toMatchObject({ created: false, ignored: { id: a.ignored.id } });
    expect(r.ignored.add({ source: "slack", project: "C1" }).ignored.label).toBe("C1");
    expect(r.ignored.list().map((x) => x.project)).toEqual(["designli/prospec-admin", "C1"]);
    const later = new Date(T0.getTime() + 60_000);
    expect(r.ignored.remove(a.ignored.id, later).id).toBe(a.ignored.id);
    expect(lastInteractionAt(r.db)).toBe(later.toISOString());
    expect(r.ignored.list()).toHaveLength(1);
    expect(() => r.ignored.remove(a.ignored.id)).toThrow(/not found/);
  });

  it("rejects an empty project and an unknown source at the schema level", () => {
    expect(() => r.db.prepare("INSERT INTO ignored_projects (id, source, project, created_at) VALUES ('x', 'github', '', 'now')").run()).toThrow();
    expect(() => r.db.prepare("INSERT INTO ignored_projects (id, source, project, created_at) VALUES ('x', 'jira', 'p', 'now')").run()).toThrow();
  });

  it("isItemIgnored uses the project key", () => {
    r.ignored.add({ source: "github", project: "designli/prospec-admin" });
    expect(r.ignored.isItemIgnored({ source: "github", externalId: "pr:designli/prospec-admin#1", project: "prospec-admin" })).toBe(true);
    expect(r.ignored.isItemIgnored({ source: "github", externalId: "pr:other/prospec-admin#1", project: "other-name" })).toBe(false);
  });
});

describe("Hoy and Tablero filtering", () => {
  it("hides open items and tasks of an ignored project from lists and counts, and un-ignoring brings them back", () => {
    const pr = item("github", "pr:designli/prospec-admin#212", "prospec-admin");
    const keep = item("github", "pr:designli/scout#3", "scout");
    const sl = item("slack", "C1:1.1", "#deploys");
    const done = item("github", "pr:designli/prospec-admin#200", "prospec-admin", { station: "done" });
    // A task made from Hoy carries the bare repo name; its linked PR item carries owner/repo.
    const t = r.tasks.create({ title: "Review 212", source: "github", project: "prospec-admin", itemIds: [pr.id] }, T0);
    const tKeep = r.tasks.create({ title: "Scout", source: "github", project: "designli/scout" }, T0);
    const tSlack = r.tasks.create({ title: "Deploy env", source: "slack", project: "C1" }, T0);
    expect(r.tasks.get(t.id).projectKey).toBe("designli/prospec-admin");

    const before = r.counts();
    expect(before.stations.inbox).toBe(3); // pr, keep, sl
    expect(before.tablero).toBe(3);

    const ig = r.ignored.add({ source: "github", project: "designli/prospec-admin", label: "prospec-admin" });
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();
    expect(ids(r.items.list({ ignored: "exclude" }))).toEqual(ids([keep, sl]));
    expect(ids(r.items.list({ ignored: "only" }))).toEqual(ids([pr, done]));
    expect(r.items.list()).toHaveLength(4); // still in the DB
    expect(ids(r.tasks.list({ ignored: "exclude" }))).toEqual(ids([tKeep, tSlack]));
    expect(ids(r.tasks.list({ ignored: "only" }))).toEqual([t.id]);
    const c = r.counts();
    expect(c.stations.inbox).toBe(2);
    expect(c.tablero).toBe(2);
    expect(c.hoy).toBe(2);
    expect(r.ignored.hiddenCounts()[ig.ignored.id]).toEqual({ items: 1, tasks: 1 });
    // Never pushed to the GitHub Project while ignored.
    expect(r.tasks.pendingSync().map((x) => x.id)).not.toContain(t.id);

    r.ignored.remove(ig.ignored.id);
    expect(r.items.list({ ignored: "exclude" })).toHaveLength(4);
    expect(r.tasks.list({ ignored: "exclude" })).toHaveLength(3);
    expect(r.counts()).toEqual(before);
    expect(r.tasks.pendingSync().map((x) => x.id)).toContain(t.id);
  });

  it("'*' ignores the project name in every source; Slack keys on the channel id", () => {
    const bc = item("basecamp", "5001", "freightmate");
    const cl = item("claude", "q1", "freightmate");
    const sl = item("slack", "C1:1.1", "#deploys");
    r.ignored.add({ source: "*", project: "freightmate" });
    r.ignored.add({ source: "slack", project: "C1", label: "#deploys" });
    const left = r.items.list({ ignored: "exclude" }).map((i) => i.id);
    expect(left).not.toContain(bc.id);
    expect(left).not.toContain(cl.id);
    expect(left).not.toContain(sl.id);
  });

  it("never touches salidas of an ignored project", () => {
    r.sessions.touch({ id: "s1", label: "triage" }, T0);
    const s = r.salidas.create(
      { source: "slack", destination: { kind: "slack_thread", workspace: "Designli", channel: "#deploys", postAs: "Andrés" }, body: "Listo.", ownerSession: "s1" },
      T0,
    );
    r.ignored.add({ source: "slack", project: "#deploys" });
    r.ignored.add({ source: "*", project: "#deploys" });
    expect(r.counts().salidas).toBe(1);
    expect(r.salidas.list({ status: ["pending"] }).map((x) => x.id)).toEqual([s.id]);
  });
});
