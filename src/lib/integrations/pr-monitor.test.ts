import { describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos } from "../repo";
import { importPrMonitorState } from "./pr-monitor";

const STATE = {
  version: 2,
  prs: {
    "acme/api#285": {
      head: "15e6fb79",
      findings: [
        { id: 1, label: "blocker", at: "src/x.ts:72", anchor: "if (x) {", summary: "no-op replay returns 200", state: "open", sha: "2ca6", ghCommentId: 3951307385 },
        { id: 2, label: "nit", summary: "rename", state: "waived" },
      ],
    },
    "acme/web#12": { head: "abc", findings: [] },
    "acme/old#3": "deadbeef",
  },
};

describe("importPrMonitorState", () => {
  it("imports findings once and leaves Mesa's own changes alone", () => {
    const r = createRepos(openDb(":memory:"));
    expect(importPrMonitorState(r, STATE)).toEqual({ prs: 1, findings: 2, skipped: 0 });
    const rv = r.reviews.byPr("acme/api", 285);
    expect(rv.headSha).toBe("15e6fb79");
    expect(rv.findings.map((f) => [f.n, f.label, f.state, f.ghCommentId])).toEqual([
      [1, "blocker", "open", "3951307385"],
      [2, "nit", "waived", null],
    ]);
    r.reviews.upsertFinding(null, { repo: "acme/api", pr: 285, n: 1, label: "blocker", summary: "no-op replay returns 200", state: "fixed" });
    expect(importPrMonitorState(r, STATE)).toEqual({ prs: 0, findings: 0, skipped: 2 });
    expect(r.reviews.byPr("acme/api", 285).findings[0]!.state).toBe("fixed");
  });

  it("tolerates a missing or odd state", () => {
    const r = createRepos(openDb(":memory:"));
    expect(importPrMonitorState(r, null)).toEqual({ prs: 0, findings: 0, skipped: 0 });
  });
});
