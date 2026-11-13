// Playwright resolution for .claude/skills/mesa-write/assets/render.mjs: override, then the repo's package, then the
// legacy checkout last. node:test, run by `pnpm test:team`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { playwrightCandidates, resolvePlaywright } from "../.claude/skills/mesa-write/assets/render.mjs";

const script = fileURLToPath(new URL("../.claude/skills/mesa-write/assets/render.mjs", import.meta.url));
const repo = join(fileURLToPath(new URL("..", import.meta.url)));
const norm = (p) => p.replace(/\\/g, "/").toLowerCase();

test("MESA_PLAYWRIGHT wins, even when it does not exist", () => {
  assert.equal(resolvePlaywright({ MESA_PLAYWRIGHT: "/x/playwright/index.mjs" }, script, () => false), "/x/playwright/index.mjs");
});

test("the repo's own node_modules comes before the legacy path, which is last", () => {
  const c = playwrightCandidates({}, script).map(norm);
  const own = norm(join(repo, "node_modules", "playwright", "index.mjs"));
  assert.ok(c.includes(own), "walks up to the repo's node_modules");
  const legacy = c.findIndex((p) => p.includes("/node_modules/.pnpm/playwright@"));
  assert.equal(legacy, c.length - 1, "legacy is the last candidate");
  assert.ok(c.indexOf(own) < legacy);
});

test("MESA_REPO is tried before the walk", () => {
  const c = playwrightCandidates({ MESA_REPO: "/some/checkout" }, script).map(norm);
  assert.equal(c[0], "/some/checkout/node_modules/playwright/index.mjs");
});

test("an ops/ folder next to an ancestor is found (a copy under the team folder)", () => {
  const copy = join("/team", ".claude", "skills", "mesa-write", "assets", "render.mjs");
  const c = playwrightCandidates({}, copy).map(norm);
  assert.ok(c.some((p) => p.endsWith("/team/ops/node_modules/playwright/index.mjs")));
});

test("picks the first candidate that exists, and says what to do when none does", () => {
  const own = norm(join(repo, "node_modules", "playwright", "index.mjs"));
  assert.equal(norm(resolvePlaywright({}, script, (p) => norm(p) === own)), own);
  assert.throws(() => resolvePlaywright({}, script, () => false), /pnpm install/);
});
