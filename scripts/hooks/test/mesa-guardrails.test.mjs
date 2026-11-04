import { test } from "node:test";
import assert from "node:assert/strict";
import { check, tokens } from "../mesa-guardrails.mjs";
import { fakeAgent, fakeMesa, unreachable } from "./helpers.mjs";

const lead = { transcript_path: "C:/x/sess.jsonl", session_id: "sess" };
const mate = () => fakeAgent({ name: "devops-t14" }).input;
const run = (base, tool_name, tool_input, fetchImpl = unreachable) => check({ ...base, tool_name, tool_input }, { fetchImpl });
const sh = (base, command, extra = {}) => run(base, "Bash", { command, ...extra });
const rule = async (p) => (await p)?.rule ?? null;

test("G1: Chrome navigate needs a tabId", async () => {
  assert.equal(await rule(run(mate(), "mcp__claude-in-chrome__navigate", { url: "https://x" })), "G1");
  assert.equal(await rule(run(mate(), "mcp__claude-in-chrome__navigate", { url: "https://x", tabId: 4 })), null);
});

test("G2: messages to retired agents are blocked", async () => {
  const mesa = fakeMesa({ "GET /api/team?status=retired": { agents: [{ name: "reviewer-t12" }] } });
  assert.equal(await rule(run(mate(), "SendMessage", { to: "reviewer-t12", message: "FAIL t12 #31" }, mesa.fetchImpl)), "G2");
  assert.equal(await rule(run(mate(), "SendMessage", { to: "tl-t14", message: "FAIL t14 #31" }, mesa.fetchImpl)), null);
});

test("G2: the retired list is cached for when Mesa is down", async () => {
  const mesa = fakeMesa({ "GET /api/team?status=retired": { agents: ["writer-t99"] } });
  await run(lead, "SendMessage", { to: "x", message: "NEED dev t1" }, mesa.fetchImpl);
  assert.equal(await rule(run(lead, "SendMessage", { to: "writer-t99", message: "BRIEF t99" })), "G2");
});

test("G3: long and ack-only messages are blocked; HANDOFF gets more room", async () => {
  const many = Array.from({ length: 13 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(await rule(run(mate(), "SendMessage", { to: "team-lead", message: many })), "G3");
  assert.equal(await rule(run(mate(), "SendMessage", { to: "team-lead", message: `HANDOFF t14 devops-t14\n${many}` })), null);
  assert.equal(await rule(run(mate(), "SendMessage", { to: "team-lead", message: "ok, will do" })), "G3");
});

test("G4: teammates cannot write to Slack, Basecamp or GitHub", async () => {
  const m = mate();
  assert.equal(await rule(run(m, "mcp__claude_ai_Slack__slack_send_message", { channel_id: "C1", message: "hi" })), "G4");
  assert.equal(await rule(run(m, "mcp__basecamp__create_comment", { content: "hi" })), "G4");
  assert.equal(await rule(run(m, "mcp__basecamp__trash_comment", { id: 1 })), "G4");
  assert.equal(await rule(run(m, "mcp__basecamp__get_comment", { id: 1 })), null);
  assert.equal(await rule(sh(m, "node C:/Users/z4yross/.claude-work/pr-gh.mjs approve a/b 1 abc")), "G4");
  assert.equal(await rule(sh(m, 'gh pr comment 3 --body "x"')), "G4");
  assert.equal(await rule(sh(m, "gh api -X POST repos/a/b/issues/1/comments -f body=x")), "G4");
  assert.equal(await rule(sh(m, "gh api repos/a/b/pulls/1/files")), null);
  assert.equal(await rule(sh(lead, "gh api repos/a/b/issues/1/comments -f body=x")), "G4");
  assert.equal(await rule(sh(m, "node G:/WorkSpace/designli/ops/bin/mesa salida sent s1 --permalink x")), "G4");
  assert.equal(await rule(sh(m, 'gh pr create --draft --title "feat(x): y" --body-file b.md')), null);
});

test("G5: the lead sends only the text of a released salida", async () => {
  const salidas = fakeMesa({
    "GET /api/salidas?status=sending": {
      salidas: [{ id: "s1", source: "basecamp", releasedAt: "2026-11-03T20:00:00Z", approvedVersion: 2, versions: [{ n: 1, body: "old" }, { n: 2, body: "Hi Matt, the **bucket** is ready: https://x.y/z" }] }],
    },
  });
  assert.equal(await rule(run(lead, "mcp__basecamp__create_comment", { content: "<p>Hi Matt, the <strong>bucket</strong> is ready: <a href='https://x.y/z'>https://x.y/z</a></p>" }, salidas.fetchImpl)), null);
  assert.equal(await rule(run(lead, "mcp__basecamp__create_comment", { content: "<p>Hi Matt, the bucket is almost ready</p>" }, salidas.fetchImpl)), "G5");
  assert.equal(await rule(run(lead, "mcp__claude_ai_Slack__slack_send_message", { channel_id: "C1", message: "Hi Matt, the bucket is ready" }, salidas.fetchImpl)), "G5");
  assert.equal(await rule(run(lead, "mcp__basecamp__create_campfire_line", { content: "hi" })), "G5");
  assert.equal(await rule(run(lead, "mcp__claude_ai_Slack__slack_schedule_message", { channel_id: "C1", message: "x" })), "G5");
});

test("G5: a released sample salida never authorises a send", async () => {
  const salidas = fakeMesa({
    "GET /api/salidas?status=sending": {
      salidas: [{ id: "s9", source: "basecamp", isSample: true, releasedAt: "2026-11-03T20:00:00Z", approvedVersion: 1, versions: [{ n: 1, body: "Muestra" }] }],
    },
  });
  assert.equal(await rule(run(lead, "mcp__basecamp__create_comment", { content: "<p>Muestra</p>" }, salidas.fetchImpl)), "G5");
});

test("G5: a list without bodies is resolved through salida show", async () => {
  const mesa = fakeMesa({
    "GET /api/salidas?status=sending": { salidas: [{ id: "s2", source: "slack", releasedAt: "2026-11-03T20:00:00Z" }] },
    "GET /api/salidas/s2": { salida: { id: "s2", approvedBody: "Listo, ya quedó." } },
  });
  assert.equal(await rule(run(lead, "mcp__claude_ai_Slack__slack_send_message", { channel_id: "C1", message: "Listo, ya quedó." }, mesa.fetchImpl)), null);
});

test("tokens ignore markup, entities and URLs", () => {
  assert.deepEqual(tokens("<p>Hola&nbsp;<b>Matt</b> — see https://a.b/c</p>"), ["hola", "matt", "see"]);
});

test("G6: git, gh and tests never run in the background; mesa wait may", async () => {
  assert.equal(await rule(sh(mate(), "git push origin HEAD", { run_in_background: true })), "G6");
  assert.equal(await rule(sh(lead, "node G:/WorkSpace/designli/ops/bin/mesa wait --loop", { run_in_background: true })), null);
  assert.equal(await rule(sh(lead, "pnpm -C G:/WorkSpace/designli/ops start", { run_in_background: true })), null);
  assert.equal(await rule(sh(lead, "pnpm -C G:/WorkSpace/designli/ops test", { run_in_background: true })), "G6");
});

test("G7: drafts only, no force push, no skipped hooks, no gh auth", async () => {
  assert.equal(await rule(sh(mate(), 'gh pr create --title "x" --body-file b.md')), "G7");
  assert.equal(await rule(sh(mate(), "git push --force origin HEAD")), "G7");
  assert.equal(await rule(sh(mate(), "git push --force-with-lease origin HEAD")), null);
  assert.equal(await rule(sh(mate(), 'git commit --no-verify -m "fix: x"')), "G7");
  assert.equal(await rule(sh(lead, "gh auth switch -u z4yross")), "G7");
});

test("commit message shape is left to the global commit-guard", async () => {
  const ok = 'git -C G:/wt -c user.name="acorrea-designli" -c user.email="andres.correa@designli.co" commit -m "feat(infra): add bucket"';
  assert.equal(await rule(sh(mate(), ok)), null);
  assert.equal(await rule(sh(mate(), 'git commit -m "feat: x" -m "body"')), null);
});

test("G5: the lead's pr-gh.mjs writes need a released github salida for that PR", async () => {
  const mesa = fakeMesa({
    "GET /api/salidas?status=sending": {
      salidas: [{ id: "g1", source: "github", releasedAt: "2026-11-03T20:00:00Z", destination: { kind: "github_review", repo: "7-Arrow/dre-backend", pr: 352, event: "APPROVE", postAs: "acorrea-designli" } }],
    },
  });
  const ps = (command) => run(lead, "PowerShell", { command }, mesa.fetchImpl);
  assert.equal(await rule(ps("node C:/Users/z4yross/.claude-work/pr-gh.mjs approve 7-Arrow/dre-backend 352 abc123")), null);
  assert.equal(await rule(ps("node C:/Users/z4yross/.claude-work/pr-gh.mjs approve 7-Arrow/dre-backend 353 abc123")), "G5");
  assert.equal(await rule(run(lead, "PowerShell", { command: "node C:/Users/z4yross/.claude-work/pr-gh.mjs reply 7-Arrow/dre-backend 352 1 b.txt" })), "G5");
});

test("G10: no approvals through the raw API", async () => {
  assert.equal(await rule(sh(lead, `curl -s -X POST http://127.0.0.1:8790/api/salidas/s1/transition -d '{"type":"approve","version":2}'`)), "G10");
  assert.equal(await rule(sh(mate(), "curl -X POST http://localhost:8790/api/tickets/t1/plan/approve")), "G10");
  assert.equal(await rule(sh(mate(), "curl -X POST http://127.0.0.1:8790/api/approvals/ap1/decision -d x")), "G10");
  assert.equal(await rule(sh(lead, "curl -s -m 3 http://127.0.0.1:8790/api/health")), null);
});

test("G10 covers the review buttons; G4 covers every lead-only salida report", async () => {
  assert.equal(await rule(sh(lead, "curl -X POST http://127.0.0.1:8790/api/reviews/r1/actions -d '{\"action\":\"approve\"}'")), "G10");
  assert.equal(await rule(sh(mate(), "node G:/WorkSpace/designli/ops/bin/mesa salida hold s1 --reason down")), "G4");
  assert.equal(await rule(sh(mate(), "node G:/WorkSpace/designli/ops/bin/mesa salida bounce s1 --reason moved")), "G4");
});

// ---------- G11: sandbox (MESA_ENV=sandbox) ----------

const sbx = (base, tool_name, tool_input, fetchImpl = unreachable) => check({ ...base, tool_name, tool_input }, { fetchImpl, sandbox: true });
const sbxSh = (base, command) => sbx(base, "Bash", { command });
const live = (base, tool_name, tool_input, fetchImpl = unreachable) => check({ ...base, tool_name, tool_input }, { fetchImpl, sandbox: false });
const NADA = /^sandbox: nada sale de aquí\. /;

test("G11: Slack and Basecamp writes are blocked for the lead and teammates, with what to do instead", async () => {
  const released = fakeMesa({ "GET /api/salidas?status=sending": { salidas: [{ id: "s1", source: "slack", releasedAt: "2026-11-03T20:00:00Z", approvedVersion: 1, versions: [{ n: 1, body: "hola" }] }] } });
  for (const who of [lead, mate()]) {
    for (const [tool, input] of [
      ["mcp__claude_ai_Slack__slack_send_message", { channel_id: "C1", message: "hola" }],
      ["mcp__claude_ai_Slack__slack_add_reaction", { name: "eyes" }],
      ["mcp__basecamp__create_comment", { content: "hola" }],
      ["mcp__basecamp__trash_comment", { id: 1 }],
      ["mcp__basecamp__create_campfire_line", { content: "hola" }],
    ]) {
      const r = await sbx(who, tool, input, released.fetchImpl);
      assert.equal(r?.rule, "G11", tool);
      assert.match(r.reason, NADA);
      assert.match(r.reason, /mesa salida sent <id> --simulated/);
    }
  }
  // Reads stay open.
  assert.equal(await rule(sbx(lead, "mcp__basecamp__get_comment", { id: 1 })), null);
  assert.equal(await rule(sbx(mate(), "mcp__claude_ai_Slack__slack_read_thread", { channel_id: "C1" })), null);
});

test("G11: pr-gh.mjs and every gh write are blocked; reads pass", async () => {
  for (const who of [lead, mate()]) {
    for (const cmd of [
      "node C:/Users/z4yross/.claude-work/pr-gh.mjs approve a/b 1 abc",
      "node C:/Users/z4yross/.claude-work/pr-gh.mjs review a/b 1 COMMENT p.json",
      "gh api -X POST repos/a/b/issues/1/comments -f body=x",
      "gh api repos/a/b/pulls/1/reviews --method PUT",
      "gh api graphql -f query=x",
      'gh pr create --draft --title "feat(x): y" --body-file b.md',
      "gh pr merge 12 --squash",
      "gh pr review 12 --approve",
      'gh pr comment 12 --body "x"',
      "gh issue create --title x",
      "gh issue comment 3 --body x",
      "gh repo create acorrea-designli/x --private",
      "gh repo edit --visibility public",
      "gh release create v1",
      "gh workflow run ci.yml",
    ]) {
      const r = await sbxSh(who, cmd);
      assert.equal(r?.rule, "G11", cmd);
      assert.match(r.reason, NADA);
    }
  }
  for (const cmd of ["gh api repos/a/b/pulls/1/files", "gh pr view 12 --json title", "gh pr diff 12", "gh search prs --review-requested=@me", "gh issue view 3", "gh repo view a/b"]) {
    assert.equal(await rule(sbxSh(lead, cmd)), null, cmd);
  }
});

test("G11: no git push; local commits and branches are the PR", async () => {
  for (const cmd of ["git push origin feat/x", "git -C G:/WorkSpace/designli-wt/dev-t3 push -u origin HEAD", "git push --force-with-lease"]) {
    const r = await sbxSh(mate(), cmd);
    assert.equal(r?.rule, "G11", cmd);
    assert.match(r.reason, /--branch/);
  }
  const commit = 'git -C G:/WorkSpace/designli-wt/dev-t3 -c user.name="dev" -c user.email="dev@example.com" commit -m "feat(x): push the button"';
  assert.equal(await rule(sbxSh(mate(), commit)), null);
  assert.equal(await rule(sbxSh(mate(), "git -C G:/WorkSpace/designli-wt/dev-t3 switch -c feat/t3")), null);
});

test("G11: the lead reports sends only as simulated and never calls the live board", async () => {
  const r = await sbxSh(lead, "node G:/WorkSpace/designli/ops/bin/mesa salida sent s1 --permalink https://x");
  assert.equal(r?.rule, "G11");
  assert.match(r.reason, /--simulated/);
  assert.equal(await rule(sbxSh(lead, "node G:/WorkSpace/designli/ops/bin/mesa salida sent s1 --simulated")), null);
  assert.equal(await rule(sbxSh(lead, "MESA_URL=http://127.0.0.1:8790 node G:/WorkSpace/designli/ops/bin/mesa ticket list")), "G11");
  assert.equal(await rule(sbxSh(lead, "curl -s -m 3 http://127.0.0.1:8790/api/health")), "G11");
  assert.equal(await rule(sbxSh(lead, "curl -s -m 3 http://127.0.0.1:8796/api/health")), null);
  // Teammates still cannot report sends at all (G4), simulated or not.
  assert.equal(await rule(sbxSh(mate(), "node G:/WorkSpace/designli/ops/bin/mesa salida sent s1 --simulated")), "G4");
  // G10 also guards the sandbox board's raw API.
  assert.equal(await rule(sbxSh(lead, `curl -s -X POST http://127.0.0.1:8796/api/salidas/s1/transition -d '{"type":"approve","version":1}'`)), "G10");
});

test("G11: live mode is unaffected", async () => {
  const salidas = fakeMesa({
    "GET /api/salidas?status=sending": {
      salidas: [
        { id: "s1", source: "slack", releasedAt: "2026-11-03T20:00:00Z", approvedVersion: 1, versions: [{ n: 1, body: "hola Ana" }] },
        { id: "g1", source: "github", releasedAt: "2026-11-03T20:00:00Z", destination: { kind: "github_review", repo: "a/b", pr: 1, event: "APPROVE", postAs: "x" } },
      ],
    },
  });
  assert.equal(await rule(live(lead, "mcp__claude_ai_Slack__slack_send_message", { channel_id: "C1", message: "hola Ana" }, salidas.fetchImpl)), null);
  assert.equal(await rule(live(lead, "PowerShell", { command: "node C:/Users/z4yross/.claude-work/pr-gh.mjs approve a/b 1 abc" }, salidas.fetchImpl)), null);
  assert.equal(await rule(live(mate(), "Bash", { command: 'gh pr create --draft --title "feat(x): y" --body-file b.md' })), null);
  assert.equal(await rule(live(mate(), "Bash", { command: "git push -u origin feat/x" })), null);
  assert.equal(await rule(live(lead, "Bash", { command: "node G:/WorkSpace/designli/ops/bin/mesa salida sent s1 --permalink https://x" })), null);
  assert.equal(await rule(live(lead, "Bash", { command: "curl -s -m 3 http://127.0.0.1:8790/api/health" })), null);
  assert.equal(await rule(live(mate(), "mcp__claude_ai_Slack__slack_send_message", { channel_id: "C1", message: "x" })), "G4");
});

test("hookSandbox reads MESA_ENV or the --env argument the installer adds", async () => {
  const { hookSandbox } = await import("../lib.mjs");
  assert.equal(hookSandbox({}, ["node", "x.mjs"]), false);
  assert.equal(hookSandbox({ MESA_ENV: "sandbox" }, ["node", "x.mjs"]), true);
  assert.equal(hookSandbox({}, ["node", "x.mjs", "--env", "sandbox"]), true);
  assert.equal(hookSandbox({ MESA_ENV: "sandbox" }, ["node", "x.mjs", "--env", "live"]), false);
});
