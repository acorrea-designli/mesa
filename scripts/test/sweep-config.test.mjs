// t143: the sweeper's GitHub repo list lives in config, with an untracked local override.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../sweep-tick.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TODAY = [
  "7-Arrow/dre-backend",
  "7-Arrow/dre-frontend",
  "7-Arrow/dre-infra",
  "7-Arrow/dre-connect-intake",
  "designli/prospec-backend",
  "designli/prospec-frontend",
  "designli/prospec-admin",
];

const withLocal = (local) => {
  const dir = mkdtempSync(join(tmpdir(), "mesa-sweep-"));
  const file = join(dir, "sweep.json");
  writeFileSync(file, readFileSync(join(REPO, "config", "sweep.json"), "utf8"));
  if (local !== undefined) writeFileSync(join(dir, "sweep.local.json"), JSON.stringify(local));
  return file;
};

test("the default repo list is the seven repos the sweeper always searched", () => {
  assert.deepEqual(loadConfig(withLocal(), {}).githubRepos, TODAY);
});

test("an untracked sweep.local.json replaces the list and merges the rest", () => {
  const c = loadConfig(withLocal({ githubRepos: ["acme/api"], sources: { slack: { workspace: "acme.slack.com" } } }), {});
  assert.deepEqual(c.githubRepos, ["acme/api"]);
  assert.equal(c.sources.slack.workspace, "acme.slack.com");
  assert.equal(c.sources.slack.userId, "U06E2UBDC73");
  assert.equal(c.activeIntervalSec, 60);
  assert.equal(c.sources.basecamp.enabled, true);
});

test("the Slack id from the environment still wins over the local file", () => {
  assert.equal(loadConfig(withLocal({ sources: { slack: { userId: "U0FILE0001" } } }), {}).sources.slack.userId, "U0FILE0001");
  assert.equal(loadConfig(withLocal({ sources: { slack: { userId: "U0FILE0001" } } }), { MESA_SLACK_USER_ID: "U0ENV00001" }).sources.slack.userId, "U0ENV00001");
});

test("`sweep-tick.mjs config` prints what the skill reads", () => {
  const out = JSON.parse(execFileSync(process.execPath, [join(REPO, "scripts", "sweep-tick.mjs"), "config"], { encoding: "utf8", env: { ...process.env, MESA_SLACK_USER_ID: "", MESA_SWEEPER_SESSION: "sweeper" } }));
  assert.equal(out.ok, true);
  assert.deepEqual(out.githubRepos, TODAY);
  assert.equal(out.slackUserId, "U06E2UBDC73");
  assert.equal(out.slackWorkspace, "designli.slack.com");
});
