// The hook messages call the owner by MESA_OWNER_NAME ("Andrés" when it is not set), so a teammate's agents are told whose
// approval they wait for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ownerName } from "../lib.mjs";
import { fakeAgent } from "./helpers.mjs";

const GUARD = fileURLToPath(new URL("../mesa-guardrails.mjs", import.meta.url));

const blockedBy = (command, env) => {
  const input = { ...fakeAgent({ name: "dev-t14" }).input, tool_name: "Bash", tool_input: { command } };
  const base = { ...process.env, MESA_URL: "http://127.0.0.1:9" };
  delete base.MESA_OWNER_NAME;
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(input), env: { ...base, ...env }, encoding: "utf8" });
  return { code: r.status, err: r.stderr };
};

test("ownerName is the configured name, trimmed, and Andrés when blank or unset", () => {
  assert.equal(ownerName({}), "Andrés");
  assert.equal(ownerName({ MESA_OWNER_NAME: "  " }), "Andrés");
  assert.equal(ownerName({ MESA_OWNER_NAME: " Ana " }), "Ana");
});

test("a guardrail message names the configured owner, and the original one by default", () => {
  const cmd = "gh pr create --title x --body y";
  const canonical = blockedBy(cmd, {});
  assert.equal(canonical.code, 2);
  assert.match(canonical.err, /Andrés decides when one is ready/);
  const ana = blockedBy(cmd, { MESA_OWNER_NAME: "Ana" });
  assert.equal(ana.code, 2);
  assert.match(ana.err, /Ana decides when one is ready/);
  assert.ok(!ana.err.includes("Andr"), ana.err);
  const review = blockedBy("gh pr review 5 --approve", { MESA_OWNER_NAME: "Ana" });
  assert.equal(review.code, 2);
  assert.match(review.err, /on Ana's behalf|Ana presses/);
  assert.ok(!review.err.includes("Andr"), review.err);
});
