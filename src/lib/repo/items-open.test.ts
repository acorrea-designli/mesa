import { describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos } from "./index";

const T0 = new Date("2026-11-09T10:00:00.000Z");

describe("items list open=you (the Hoy notifier's feed)", () => {
  it("returns open items waiting on Andrés, without samples and ignored projects", () => {
    const r = createRepos(openDb(":memory:"));
    const make = (externalId: string, over: Record<string, unknown> = {}) =>
      r.items.upsert({ source: "github", externalId, kind: "pr_review", title: externalId, excerpt: "", project: "designli/scout-api", station: "inbox", waitOn: "you", ...over }, T0).item;
    make("open");
    make("doing", { station: "doing" });
    make("client", { waitOn: "client" });
    make("done", { station: "done", waitOn: "none" });
    make("sample", { isSample: true });
    r.ignored.add({ source: "github", project: "designli/prospec-admin" });
    make("ignored", { project: "designli/prospec-admin" });
    const ids = r.items.list({ open: "you", includeSamples: false, ignored: "exclude" }).map((i) => i.externalId).sort();
    expect(ids).toEqual(["doing", "open"]);
    expect(r.items.list({ open: "you" }).map((i) => i.externalId).sort()).toEqual(["doing", "ignored", "open", "sample"]);
  });
});
