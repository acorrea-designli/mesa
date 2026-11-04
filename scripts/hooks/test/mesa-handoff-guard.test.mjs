import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../mesa-handoff-guard.mjs";
import { fakeAgent, fakeMesa, said, sent, unreachable } from "./helpers.mjs";

const now = Date.parse("2026-11-03T20:00:00Z");
const handoffs = (list) => fakeMesa({ "GET /api/handoffs": { handoffs: list } }).fetchImpl;

test("stop_hook_active always lets the stop through", async () => {
  const { input } = fakeAgent({ name: "tl-t5" });
  assert.equal(await check({ ...input, stop_hook_active: true }, { fetchImpl: unreachable, now }), null);
});

test("the lead is never blocked", async () => {
  assert.equal(await check({ transcript_path: "C:/x/sess.jsonl", session_id: "sess" }, { fetchImpl: unreachable, now }), null);
});

test("an agent outside the naming convention is never blocked", async () => {
  const { input } = fakeAgent({ name: "Explore" });
  assert.equal(await check(input, { fetchImpl: unreachable, now }), null);
});

test("H1: no handoff blocks with the exact command", async () => {
  const { input } = fakeAgent({ name: "reviewer-t12-2" });
  const r = await check(input, { fetchImpl: handoffs([]), now });
  assert.equal(r.decision, "block");
  assert.match(r.reason, /H1/);
  assert.match(r.reason, /mesa handoff t12 --agent reviewer-t12-2 --status paused/);
});

test("a handoff for another ticket does not count", async () => {
  const { input } = fakeAgent({ name: "dev-t3" });
  const r = await check(input, { fetchImpl: handoffs([{ ticketRef: "t9", status: "done", createdAt: "2026-11-03T19:59:00Z" }]), now });
  assert.match(r.reason, /H1/);
});

test("any handoff lets a mid-task idle through", async () => {
  const { input } = fakeAgent({ name: "tl-t5", lines: [said("Waiting for Andrés on t5.")] });
  assert.equal(await check(input, { fetchImpl: handoffs([{ ticketRef: "t5", status: "paused", createdAt: "2026-11-03T10:00:00Z" }]), now }), null);
});

test("H2: DONE with a stale or non-final handoff blocks", async () => {
  const { input } = fakeAgent({ name: "devops-t14", lines: [sent("DONE t14 devops-t14 PR #31 open")] });
  const stale = await check(input, { fetchImpl: handoffs([{ ticketRef: "t14", status: "done", createdAt: "2026-11-03T19:00:00Z" }]), now });
  assert.match(stale.reason, /H2.*60 min old/);
  const paused = await check(input, { fetchImpl: handoffs([{ ticketRef: "t14", status: "paused", createdAt: "2026-11-03T19:58:00Z" }]), now });
  assert.match(paused.reason, /H2.*status paused/);
  assert.match(paused.reason, /--status done/);
});

test("DONE with a fresh final handoff stops", async () => {
  const { input } = fakeAgent({ name: "devops-t14", lines: [said("DONE t14")] });
  assert.equal(await check(input, { fetchImpl: handoffs([{ ticketRef: "t14", status: "done", createdAt: "2026-11-03T19:55:00Z" }]), now }), null);
});

test("H3: unreachable Mesa blocks once with the engram fallback", async () => {
  const { input } = fakeAgent({ name: "writer-t2" });
  const r = await check(input, { fetchImpl: unreachable, now });
  assert.match(r.reason, /H3/);
  assert.match(r.reason, /mesa\/t2\/handoff\/writer-t2/);
  assert.match(r.reason, /HANDOFF t2 writer-t2/);
});

test("the name resolves from the agent id when there is no meta file", async () => {
  const { input } = fakeAgent({ agentId: "areviewer-t7-0123456789abcdef" });
  const r = await check(input, { fetchImpl: handoffs([]), now });
  assert.match(r.reason, /reviewer-t7/);
});

test("the name resolves from the spawn prompt as a last resort", async () => {
  const { input } = fakeAgent({ agentId: "a0f0f0f0f0f0f0f0f", prompt: "You are `researcher-t8`. Ticket t8." });
  const r = await check(input, { fetchImpl: handoffs([]), now });
  assert.match(r.reason, /researcher-t8/);
});
