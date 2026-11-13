// t143: the hooks name the Mesa CLI and repo of the checkout they run from, not a fixed path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../mesa-handoff-guard.mjs";
import { mesaCli, mesaRepo } from "../lib.mjs";
import { startsOwnServer } from "../mesa-guardrails.mjs";
import { fakeAgent, fakeMesa } from "./helpers.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..").replace(/\\/g, "/");

test("mesaRepo is the checkout the hooks live in, with forward slashes and no trailing slash; MESA_REPO overrides it", () => {
  assert.equal(mesaRepo({}), REPO);
  assert.equal(mesaCli({}), `node ${REPO}/bin/mesa`);
  assert.equal(mesaRepo({ MESA_REPO: "D:\\work\\mesa\\" }), "D:/work/mesa");
  assert.equal(mesaCli({ MESA_REPO: "G:/WorkSpace/designli/ops" }), "node G:/WorkSpace/designli/ops/bin/mesa");
  assert.equal(mesaRepo({ MESA_REPO: "  " }), REPO);
});

test("the handoff guard prints this checkout's CLI", async () => {
  const { input } = fakeAgent({ name: "dev-t12" });
  const r = await check(input, { fetchImpl: fakeMesa({ "GET /api/handoffs": { handoffs: [] } }).fetchImpl, now: Date.now() });
  assert.ok(r.reason.includes(`${REPO}/bin/mesa handoff t12 --agent dev-t12 --status paused`), r.reason);
});

test("pnpm -C <this checkout> start|dev may run in the background, other checkouts only by the old pattern", () => {
  assert.equal(startsOwnServer(`pnpm -C ${REPO} start`), true);
  assert.equal(startsOwnServer(`pnpm --dir "${REPO}/" dev`), true);
  assert.equal(startsOwnServer(`pnpm -C ${REPO.toUpperCase()} start`), true);
  assert.equal(startsOwnServer(`pnpm -C ${REPO} test`), false);
  assert.equal(startsOwnServer(`pnpm -C ${REPO}-other start`), false);
  assert.equal(startsOwnServer("pnpm start"), false);
  assert.equal(startsOwnServer("pnpm -C D:/mesa start", "D:/mesa"), true);
});
