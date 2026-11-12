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

const MESA_REPLY = "node G:/WorkSpace/designli/ops/bin/mesa ticket reply t48";
const heredoc = (body, extra = "") => `${MESA_REPLY} --body -${extra} <<'EOF'\n${body}\nEOF`;
const reviewer = () => fakeAgent({ name: "reviewer-t48" }).input;
const findings = "1 blocker, 2 nits.\n1. [blocker] src/api/eval.ts:42 the permission is not checked.\n2. [nit] src/api/eval.ts:60 rename.";

test("G12: a reviewer's one-line reply is allowed", async () => {
  const r = reviewer();
  assert.equal(await rule(sh(r, heredoc("1 blocker, 2 nits: el permiso por tipo de evaluación solo lo aplica el selector."))), null);
  assert.equal(await rule(sh(r, heredoc("Sin hallazgos, recomiendo Approve."))), null);
  assert.equal(await rule(sh(r, heredoc("1 blocker, 1 nit: falta el permiso.\nno mergear antes de be#473"))), null);
  assert.equal(await rule(sh(r, heredoc("Detalle en el hallazgo 2 de la tarjeta."), " --ask")), null);
  assert.equal(await rule(run(r, "PowerShell", { command: heredoc("0 blockers, 1 nit: solo un nombre.") })), null);
});

test("G12: a reviewer's multi-line findings list is blocked", async () => {
  const r = reviewer();
  const b = await sh(r, heredoc(findings));
  assert.equal(b?.rule, "G12");
  assert.match(b.reason, /mesa-review § Ask/);
  assert.match(b.reason, /1 blocker, 2 nits: <the blocker in plain words>\./);
  assert.equal(await rule(sh(r, heredoc("uno\ndos\ntres"))), "G12");
  assert.equal(await rule(sh(r, heredoc("uno\n\ndos\n\n"))), null);
  assert.equal(await rule(run(r, "PowerShell", { command: heredoc(findings) })), "G12");
});

test("G12: a path:line or a sha in a reviewer's one-line reply is blocked", async () => {
  const r = reviewer();
  assert.equal(await rule(sh(r, heredoc("1 blocker: src/x.ts:12 no valida el permiso."))), "G12");
  assert.equal(await rule(sh(r, heredoc("1 nit: x.tsx:7 renombrar"))), "G12");
  assert.equal(await rule(sh(r, heredoc("re-review 2d3d0df..5434391: 1 arreglado"))), "G12");
  assert.equal(await rule(sh(r, heredoc("verificación en 5434391bda98e7c888617f9a9103e0cde2a5d2ce"))), "G12");
  // plain numbers, words and PR refs are not shas or paths
  assert.equal(await rule(sh(r, heredoc("1 blocker: el límite de 1234567 filas; no mergear antes de be#473; decaded ya."))), null);
});

test("G12: the quoted --body form is covered", async () => {
  const r = reviewer();
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body "1 blocker, 2 nits: falta el permiso."`)), null);
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body '1 blocker, 2 nits: falta el permiso.' --ask`)), null);
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body "1 blocker: src/x.ts:12 falta el permiso."`)), "G12");
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body='fixed in 2d3d0df'`)), "G12");
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body "uno\ndos\ntres"`)), "G12");
  assert.equal(await rule(run(r, "PowerShell", { command: `${MESA_REPLY} --body "1 blocker: a/b.ts:3 mal."` })), "G12");
  assert.equal(await rule(run(r, "PowerShell", { command: `${MESA_REPLY} --body @'\nuno\ndos\ntres\n'@` })), "G12");
});

test("G12: only reviewers are held to it; the lead, tl, dev and writer reply freely", async () => {
  for (const who of [lead, fakeAgent({ name: "tl-t48" }).input, fakeAgent({ name: "dev-t48" }).input, fakeAgent({ name: "writer-t48" }).input]) {
    assert.equal(await rule(sh(who, heredoc(findings))), null);
    assert.equal(await rule(sh(who, `${MESA_REPLY} --body "1 blocker: src/x.ts:12 falta 2d3d0df."`)), null);
  }
});

test("G12: other reviewer commands are untouched", async () => {
  const r = reviewer();
  const handoff = "node G:/WorkSpace/designli/ops/bin/mesa handoff t48 --agent reviewer-t48 --status paused --body - <<'EOF'\nline 1\nsrc/x.ts:12\n2d3d0df\nEOF";
  assert.equal(await rule(sh(r, handoff)), null);
  assert.equal(await rule(sh(r, "node G:/WorkSpace/designli/ops/bin/mesa finding upsert t48 --json - <<'EOF'\n{\"at\":\"src/x.ts:12\"}\nEOF")), null);
  assert.equal(await rule(sh(r, "gh api repos/a/b/pulls/1/files")), null);
});

test("G12: a reply body the command does not show is blocked, with the heredoc as the way out", async () => {
  const r = reviewer();
  const pipe = await sh(r, `cat C:/tmp/reply.md | ${MESA_REPLY} --body -`);
  assert.equal(pipe?.rule, "G12");
  assert.match(pipe.reason, /heredoc/);
  assert.match(pipe.reason, /<<'EOF'/);
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body - < C:/tmp/reply.md`)), "G12");
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body "$BODY"`)), "G12");
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body "$(cat C:/tmp/reply.md)"`)), "G12");
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body $BODY`)), "G12");
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body "uno \`date\`"`)), "G12");
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body -`)), "G12");
  assert.equal(await rule(run(r, "PowerShell", { command: `Get-Content C:/tmp/reply.md | ${MESA_REPLY} --body -` })), "G12");
  assert.equal(await rule(run(r, "PowerShell", { command: `${MESA_REPLY} --body $body` })), "G12");
});

test("G12: a here-string piped into --body - is read, so a one-line one passes", async () => {
  const r = reviewer();
  assert.equal(await rule(run(r, "PowerShell", { command: `@'\n1 blocker, 2 nits: falta el permiso.\n'@ | ${MESA_REPLY} --body -` })), null);
  assert.equal(await rule(run(r, "PowerShell", { command: `@'\nuno\ndos\ntres\n'@ | ${MESA_REPLY} --body -` })), "G12");
  assert.equal(await rule(run(r, "PowerShell", { command: `@'\n1 blocker: src/x.ts:12 mal.\n'@ | ${MESA_REPLY} --body -` })), "G12");
});

test("G12: an expanding heredoc or @\"...\"@ here-string with a $ or a backtick is unreadable", async () => {
  const r = reviewer();
  const ps = (command) => run(r, "PowerShell", { command });
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body - <<EOF\n$(cat C:/tmp/reply.md)\nEOF`)), "G12");
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body - <<EOF\n$BODY\nEOF`)), "G12");
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body - <<EOF\n\`cat C:/tmp/reply.md\`\nEOF`)), "G12");
  assert.equal(await rule(ps(`${MESA_REPLY} --body @"\n$(Get-Content C:/tmp/reply.md -Raw)\n"@`)), "G12");
  assert.equal(await rule(ps(`@"\n$(Get-Content C:/tmp/reply.md -Raw)\n"@ | ${MESA_REPLY} --body -`)), "G12");
  // Still readable: a quoted heredoc or @'...'@ is literal, and an expanding one with no $ or backtick is plain text.
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body - <<'EOF'\ncuesta $5 y $(no se ejecuta).\nEOF`)), null);
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body - <<"EOF"\ncuesta $5 y $(no se ejecuta).\nEOF`)), null);
  assert.equal(await rule(ps(`${MESA_REPLY} --body @'\ncuesta $5 y $(no se ejecuta).\n'@`)), null);
  assert.equal(await rule(ps(`@'\n$(literal) 1 nit.\n'@ | ${MESA_REPLY} --body -`)), null);
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body - <<EOF\n1 blocker, 2 nits: falta el permiso.\nEOF`)), null);
  assert.equal(await rule(ps(`${MESA_REPLY} --body @"\n1 blocker, 2 nits: falta el permiso.\n"@`)), null);
});

test("G12: the reply is found on any line of a multi-line command", async () => {
  const r = reviewer();
  const ps = (command) => run(r, "PowerShell", { command });
  assert.equal(await rule(sh(r, `B=$(cat C:/tmp/reply.md)\n${MESA_REPLY} --body "$B"`)), "G12");
  assert.equal(await rule(sh(r, `true\ncat C:/tmp/reply.md | ${MESA_REPLY} --body -`)), "G12");
  assert.equal(await rule(sh(r, `cd C:/tmp\n${MESA_REPLY} --body - < reply.md`)), "G12");
  assert.equal(await rule(ps(`$b = Get-Content C:/tmp/reply.md -Raw\n${MESA_REPLY} --body $b`)), "G12");
  assert.equal(await rule(ps(`$b = Get-Content C:/tmp/reply.md -Raw\n${MESA_REPLY} --body "$b"`)), "G12");
  assert.equal(await rule(sh(r, `echo hi\n${MESA_REPLY} --body - <<EOF\n$(cat C:/tmp/reply.md)\nEOF`)), "G12");
  assert.equal(await rule(sh(r, `echo hi\n${heredoc("uno\ndos\ntres")}`)), "G12");
  assert.equal(await rule(sh(r, `${MESA_REPLY} \\\n  --body - <<EOF\n$(cat C:/tmp/reply.md)\nEOF`)), "G12");
  // A later-line reply with a readable one-line body still passes.
  assert.equal(await rule(sh(r, `echo hi\n${heredoc("1 blocker, 2 nits: falta el permiso.")}`)), null);
  assert.equal(await rule(sh(r, `cd C:/tmp\n${MESA_REPLY} --body 'sin hallazgos, Approve.'`)), null);
  assert.equal(await rule(sh(r, `${MESA_REPLY} \\\n  --body - <<'EOF'\n1 blocker, 2 nits: falta el permiso.\nEOF`)), null);
  assert.equal(await rule(sh(r, "echo no es una respuesta\nls")), null);
});

test("G12: another command's heredoc or here-string body that mentions the reply command is data, not a reply", async () => {
  const r = reviewer();
  const ps = (command) => run(r, "PowerShell", { command });
  const MESA = "node G:/WorkSpace/designli/ops/bin/mesa";
  const text = "G12 now finds mesa ticket reply on any line.\nsrc/x.ts:12 and 2d3d0df";
  assert.equal(await rule(sh(r, `${MESA} handoff t66 --agent reviewer-t66 --status done --body - <<'EOF'\n${text}\nEOF`)), null);
  assert.equal(await rule(sh(r, `${MESA} handoff t66 --agent reviewer-t66 --status done --body - <<EOF\n${text}\nEOF`)), null);
  assert.equal(await rule(sh(r, `${MESA} handoff t66 --agent reviewer-t66 --status done --body - <<-'EOF'\n\t${text}\n\tEOF`)), null);
  assert.equal(await rule(sh(r, `${MESA} finding upsert t66 --json - <<'EOF'\n{"n":2,"summary":"a reply (\`mesa ticket reply t1 --body \\"$B\\"\`) is found"}\nEOF`)), null);
  assert.equal(await rule(sh(r, `${MESA} ticket brief t66 --body - <<'EOF'\nThe reviewer posts one mesa ticket reply per pass.\nEOF`)), null);
  assert.equal(await rule(ps(`${MESA} handoff t66 --agent reviewer-t66 --status done --body @'\n${text}\n'@`)), null);
  assert.equal(await rule(ps(`${MESA} handoff t66 --agent reviewer-t66 --status done --body @"\n${text}\n"@`)), null);
  assert.equal(await rule(ps(`$h = @'\n${text}\n'@\n${MESA} handoff t66 --agent reviewer-t66 --status done --body $h`)), null);
  // The reply after such a body is still found and checked.
  assert.equal(await rule(sh(r, `${MESA} handoff t66 --agent reviewer-t66 --status done --body - <<'EOF'\n${text}\nEOF\n${MESA_REPLY} --body "$B"`)), "G12");
  assert.equal(await rule(sh(r, `${MESA} handoff t66 --agent reviewer-t66 --status done --body - <<'EOF'\nok\nEOF\n${heredoc("uno\ndos\ntres")}`)), "G12");
  assert.equal(await rule(sh(r, `${MESA} handoff t66 --agent reviewer-t66 --status done --body - <<'EOF'\nok\nEOF\n${heredoc("1 blocker, 2 nits: falta el permiso.")}`)), null);
  assert.equal(await rule(ps(`$h = @'\n${text}\n'@\n${MESA_REPLY} --body $h`)), "G12");
});

test("G12: code after a here-string closer, a heredoc opener or a not-bare terminator is still scanned", async () => {
  const r = reviewer();
  const ps = (command) => run(r, "PowerShell", { command });
  const MESA = "node G:/WorkSpace/designli/ops/bin/mesa";
  // PowerShell runs what follows the closer on the same line.
  assert.equal(await rule(ps(`$h = @'\nbody\n'@; ${MESA_REPLY} --body $h`)), "G12");
  assert.equal(await rule(ps(`$h = @"\nbody\n"@; ${MESA_REPLY} --body $h`)), "G12");
  assert.equal(await rule(ps(`$h = @'\nbody\n'@; ${MESA} handoff t66 --agent reviewer-t66 --status done --body $h`)), null);
  // Bash: only a bare delimiter closes a heredoc, so `EOF; mesa ...` is still body text (data).
  assert.equal(await rule(sh(r, `${MESA} handoff t66 --agent reviewer-t66 --status done --body - <<'EOF'\nbody\nEOF; ${MESA_REPLY} --body "$B"\nmore\nEOF`)), null);
  assert.equal(await rule(sh(r, `${MESA} handoff t66 --agent reviewer-t66 --status done --body - <<'EOF'\nbody\nEOF\n${MESA_REPLY} --body "$B"`)), "G12");
  // Code on the opener line, after the delimiter, runs.
  assert.equal(await rule(sh(r, `cat <<'X' >f; ${MESA_REPLY} --body "$(cat f)"\nbody\nX`)), "G12");
});

test("G12: a single-quoted body is literal, so a $ in it is allowed", async () => {
  const r = reviewer();
  assert.equal(await rule(sh(r, `${MESA_REPLY} --body 'cuesta $5, 1 nit.'`)), null);
});

test("G12: an unreadable body is only a problem for a reviewer's ticket reply", async () => {
  for (const who of [lead, fakeAgent({ name: "tl-t48" }).input, fakeAgent({ name: "dev-t48" }).input]) {
    assert.equal(await rule(sh(who, `cat C:/tmp/reply.md | ${MESA_REPLY} --body -`)), null);
    assert.equal(await rule(sh(who, `${MESA_REPLY} --body "$BODY"`)), null);
  }
  const r = reviewer();
  assert.equal(await rule(sh(r, "node G:/WorkSpace/designli/ops/bin/mesa handoff t48 --agent reviewer-t48 --status paused --body - < C:/tmp/h.md")), null);
  assert.equal(await rule(sh(r, "cat C:/tmp/reply.md | node G:/WorkSpace/designli/ops/bin/mesa finding upsert t48 --json -")), null);
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
    "GET /api/salidas?status=sending": { salidas: [{ id: "s2", source: "basecamp", releasedAt: "2026-11-03T20:00:00Z" }] },
    "GET /api/salidas/s2": { salida: { id: "s2", approvedBody: "Listo, ya quedó." } },
  });
  assert.equal(await rule(run(lead, "mcp__basecamp__create_campfire_line", { content: "Listo, ya quedó." }, mesa.fetchImpl)), null);
});

const commentSalida = (mentions, extra = {}) => ({
  id: "c1",
  source: "basecamp",
  releasedAt: "2026-11-03T20:00:00Z",
  approvedVersion: 1,
  versions: [{ n: 1, body: "Hi Matt, the bucket is ready" }],
  destination: { kind: "basecamp_comment", project: "Scout", postAs: "A", ...(mentions ? { mentions } : {}) },
  ...extra,
});
const sendComment = (mesa, mentions) => run(lead, "mcp__basecamp__create_comment", { content: "<p>Hi Matt, the bucket is ready</p>", ...(mentions ? { mentions } : {}) }, mesa.fetchImpl);

test("G5: a create_comment passes only with the mentions of the released salida's destination", async () => {
  const withMentions = fakeMesa({ "GET /api/salidas?status=sending": { salidas: [commentSalida([{ id: "9001", name: "Matt Myers" }, { id: "9002", name: "Ana Ruiz" }])] } });
  // match: same set, numbers against string ids, any order
  assert.equal(await rule(sendComment(withMentions, [9002, 9001])), null);
  // mismatch: fewer, more, different, none
  for (const got of [[9001], [9001, 9002, 9003], [9001, 9999], undefined]) {
    const r = await sendComment(withMentions, got);
    assert.equal(r?.rule, "G5", JSON.stringify(got));
    assert.match(r.reason, /mentions do not/);
    assert.match(r.reason, /9001, 9002/);
  }
});

test("G5: a salida with no mentions allows only a create_comment with none", async () => {
  for (const salida of [commentSalida(undefined), commentSalida([])]) {
    const mesa = fakeMesa({ "GET /api/salidas?status=sending": { salidas: [salida] } });
    assert.equal(await rule(sendComment(mesa, undefined)), null);
    assert.equal(await rule(sendComment(mesa, [])), null);
    const r = await sendComment(mesa, [9001]);
    assert.equal(r?.rule, "G5");
    assert.match(r.reason, /\[none\]/);
  }
});

test("G5: the mentions check reads the destination from salida show when the list has no bodies, and a stringified destination", async () => {
  const listed = { id: "c1", source: "basecamp", releasedAt: "2026-11-03T20:00:00Z" };
  const full = fakeMesa({
    "GET /api/salidas?status=sending": { salidas: [listed] },
    "GET /api/salidas/c1": { salida: commentSalida([{ id: "9001", name: "Matt" }]) },
  });
  assert.equal(await rule(sendComment(full, [9001])), null);
  assert.equal((await sendComment(full, undefined))?.rule, "G5");
  const text = fakeMesa({ "GET /api/salidas?status=sending": { salidas: [commentSalida(undefined, { destination: JSON.stringify({ kind: "basecamp_comment", mentions: [{ id: "7", name: "X" }] }) })] } });
  assert.equal(await rule(sendComment(text, [7])), null);
  assert.equal((await sendComment(text, [8]))?.rule, "G5");
});

test("G5: a second released salida with the same text and the right mentions is the match", async () => {
  const mesa = fakeMesa({ "GET /api/salidas?status=sending": { salidas: [commentSalida([{ id: "1", name: "A" }], { id: "c1" }), commentSalida(undefined, { id: "c2" })] } });
  assert.equal(await rule(sendComment(mesa, undefined)), null);
  assert.equal(await rule(sendComment(mesa, [1])), null);
  assert.equal((await sendComment(mesa, [2]))?.rule, "G5");
});

// A released Slack salida as Mesa lists it. Its mode is the one Andrés chose with his approval click.
const slackSalida = (over = {}) => ({
  id: "sl1",
  source: "slack",
  releasedAt: "2026-11-03T20:00:00Z",
  approvedVersion: 2,
  sendMode: "draft",
  versions: [{ n: 1, body: "old text" }, { n: 2, body: "Hi Matt, **confirmed**: https://x.y/z" }],
  destination: { kind: "slack_thread", workspace: "designli", channel: "#scout-dev", channelId: "C0123ABCD", threadTs: "1730640660.118000", postAs: "Andrés" },
  ...over,
});
const slackMesa = (...salidas) => fakeMesa({ "GET /api/salidas?status=sending": { salidas } });
const DRAFT = "mcp__claude_ai_Slack__slack_send_message_draft";
const SEND = "mcp__claude_ai_Slack__slack_send_message";
const slackCall = { channel_id: "C0123ABCD", thread_ts: "1730640660.118000", message: "Hi Matt, *confirmed*: <https://x.y/z>" };

test("G5: slack_send_message_draft passes only for a released salida in mode draft with that text and target", async () => {
  const mesa = slackMesa(slackSalida());
  assert.equal(await rule(run(lead, DRAFT, slackCall, mesa.fetchImpl)), null);
  // a salida released before modes existed carries none: the default, draft
  const legacy = slackMesa(slackSalida({ sendMode: undefined }));
  assert.equal(await rule(run(lead, DRAFT, slackCall, legacy.fetchImpl)), null);
  // snake_case rows too
  const snake = slackMesa(slackSalida({ sendMode: undefined, send_mode: "draft" }));
  assert.equal(await rule(run(lead, DRAFT, slackCall, snake.fetchImpl)), null);
});

test("G5: slack_send_message passes only for a released salida in mode send with that text and target", async () => {
  const mesa = slackMesa(slackSalida({ sendMode: "send" }));
  assert.equal(await rule(run(lead, SEND, slackCall, mesa.fetchImpl)), null);
});

test("G5: the wrong tool for the mode is refused with the right path (a draft is never sent, a direct send never drafted)", async () => {
  const draftMode = slackMesa(slackSalida({ sendMode: "draft" }));
  const r = await run(lead, SEND, slackCall, draftMode.fetchImpl);
  assert.equal(r?.rule, "G5");
  assert.match(r.reason, /approved as a draft/);
  assert.match(r.reason, /slack_send_message_draft/);
  assert.match(r.reason, /mesa salida drafted sl1/);
  assert.match(r.reason, /never switch a draft to a send/);

  const sendMode = slackMesa(slackSalida({ sendMode: "send" }));
  const d = await run(lead, DRAFT, slackCall, sendMode.fetchImpl);
  assert.equal(d?.rule, "G5");
  assert.match(d.reason, /Claude lo envía/);
  assert.match(d.reason, /slack_send_message/);
  assert.match(d.reason, /mesa salida sent sl1/);
});

test("G5: a different text is refused for both Slack tools", async () => {
  const mesa = slackMesa(slackSalida({ sendMode: "draft" }), slackSalida({ id: "sl2", sendMode: "send", approvedVersion: 1 }));
  for (const tool of [DRAFT, SEND]) {
    const r = await run(lead, tool, { ...slackCall, message: "Hi Matt, confirmed AND shipped" }, mesa.fetchImpl);
    assert.equal(r?.rule, "G5", tool);
    assert.match(r.reason, /exactly this text/);
  }
  // sl2's approved version is v1 ("old text"): that is what its mode-send tool may carry, nothing else
  assert.equal(await rule(run(lead, SEND, { ...slackCall, message: "old text" }, slackMesa(slackSalida({ id: "sl2", sendMode: "send", approvedVersion: 1 })).fetchImpl)), null);
  // an old version's text is not the approved one of sl1 (approved v2)
  assert.equal(await rule(run(lead, DRAFT, { ...slackCall, message: "old text" }, slackMesa(slackSalida()).fetchImpl)), "G5");
});

test("G5: the channel and the thread must be the salida's destination", async () => {
  const mesa = slackMesa(slackSalida());
  for (const bad of [{ channel_id: "C9999" }, { channel_id: undefined }, { thread_ts: "1730640660.999999" }, { thread_ts: undefined }]) {
    const r = await run(lead, DRAFT, { ...slackCall, ...bad }, mesa.fetchImpl);
    assert.equal(r?.rule, "G5", JSON.stringify(bad));
    assert.match(r.reason, /target does not/);
    assert.match(r.reason, /C0123ABCD, thread 1730640660\.118000/);
  }
  // a channel salida (no thread) accepts no thread_ts
  const channel = slackMesa(slackSalida({ destination: { kind: "slack_channel", workspace: "designli", channel: "#pruebas", channelId: "C0123ABCD", postAs: "Andrés" } }));
  assert.equal(await rule(run(lead, DRAFT, { channel_id: "C0123ABCD", message: slackCall.message }, channel.fetchImpl)), null);
  assert.equal(await rule(run(lead, DRAFT, slackCall, channel.fetchImpl)), "G5");
  // a destination without channelId can never match
  const noId = slackMesa(slackSalida({ destination: { kind: "slack_channel", workspace: "designli", channel: "#pruebas", postAs: "Andrés" } }));
  assert.equal(await rule(run(lead, DRAFT, { message: slackCall.message }, noId.fetchImpl)), "G5");
});

test("G5: no released salida, an unreleased one, a sample or another source all refuse both Slack tools", async () => {
  const cases = {
    none: slackMesa(),
    unreleased: slackMesa(slackSalida({ releasedAt: null })),
    sample: slackMesa(slackSalida({ isSample: true })),
    basecamp: slackMesa(slackSalida({ source: "basecamp" })),
  };
  for (const [name, mesa] of Object.entries(cases)) {
    for (const tool of [DRAFT, SEND]) assert.equal(await rule(run(lead, tool, slackCall, mesa.fetchImpl)), "G5", `${name} ${tool}`);
  }
  // Mesa lists only `sending` salidas: once drafted (draft_created) or sent it is gone from the list, so a second call has no match.
  const none = await run(lead, DRAFT, slackCall, slackMesa().fetchImpl);
  assert.match(none.reason, /already drafted or sent is done/);
});

test("G5: the Slack check reads the approved text from salida show when the list has no bodies, and a stringified destination", async () => {
  const listed = { id: "sl1", source: "slack", releasedAt: "2026-11-03T20:00:00Z", sendMode: "draft" };
  const mesa = fakeMesa({
    "GET /api/salidas?status=sending": { salidas: [listed] },
    "GET /api/salidas/sl1": { salida: slackSalida({ destination: JSON.stringify(slackSalida().destination) }) },
  });
  assert.equal(await rule(run(lead, DRAFT, slackCall, mesa.fetchImpl)), null);
  assert.equal(await rule(run(lead, SEND, slackCall, mesa.fetchImpl)), "G5");
});

test("G5: with Mesa unreachable both Slack tools are blocked, and teammates still get G4", async () => {
  for (const tool of [DRAFT, SEND]) {
    const r = await run(lead, tool, slackCall, unreachable);
    assert.equal(r?.rule, "G5", tool);
    assert.match(r.reason, /unreachable/);
    assert.equal(await rule(run(mate(), tool, slackCall, slackMesa(slackSalida()).fetchImpl)), "G4", tool);
  }
});

test("G5: the other Slack tools keep their rules: schedule is refused, reads are open", async () => {
  assert.equal(await rule(run(lead, "mcp__claude_ai_Slack__slack_schedule_message", { channel_id: "C1", message: "x" })), "G5");
  assert.equal(await rule(run(lead, "mcp__claude_ai_Slack__slack_read_thread", { channel_id: "C1" })), null);
});

test("G10: nobody sets the Slack mode or presses Ya lo envié through the raw API", async () => {
  for (const body of ['{"type":"approve","version":1,"mode":"send"}', '{"type":"confirm_sent"}']) {
    for (const who of [lead, mate()]) {
      const r = await sh(who, `curl -s -X POST http://127.0.0.1:8790/api/salidas/sl1/transition -H 'content-type: application/json' -d '${body}'`);
      assert.equal(r?.rule, "G10", body);
      assert.match(r.reason, /Ya lo envié/);
    }
  }
});

test("G4: a teammate cannot report a draft; the lead can", async () => {
  assert.equal(await rule(sh(mate(), "node G:/WorkSpace/designli/ops/bin/mesa salida drafted s1")), "G4");
  assert.equal(await rule(sh(lead, "node G:/WorkSpace/designli/ops/bin/mesa salida drafted s1")), null);
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
  for (const p of ["approvals/ap1/approve", "approvals/ap1/read-config", "approvals/ap1/deny", "tickets/t10/permission-request"]) {
    assert.equal(await rule(sh(mate(), `curl -X POST http://127.0.0.1:8796/api/${p}`)), "G10", p);
    assert.equal(await rule(sh(mate(), `Invoke-RestMethod -Method Post http://localhost:8790/api/${p}`)), "G10", p);
  }
  // reading an approval is fine
  assert.notEqual(await rule(sh(mate(), "curl http://127.0.0.1:8790/api/approvals/ap1")), "G10");
  assert.equal(await rule(sh(lead, "curl -s -m 3 http://127.0.0.1:8790/api/health")), null);
});

test("G10 covers the review buttons; G4 covers every lead-only salida report", async () => {
  assert.equal(await rule(sh(lead, "curl -X POST http://127.0.0.1:8790/api/reviews/r1/actions -d '{\"action\":\"approve\"}'")), "G10");
  assert.equal(await rule(sh(mate(), "node G:/WorkSpace/designli/ops/bin/mesa salida hold s1 --reason down")), "G4");
  assert.equal(await rule(sh(mate(), "node G:/WorkSpace/designli/ops/bin/mesa salida bounce s1 --reason moved")), "G4");
});

test("G4: withdrawing a salida and closing a review card are the lead's; a teammate is blocked, the lead passes", async () => {
  const withdraw = 'node G:/WorkSpace/designli/ops/bin/mesa salida withdraw sa_1 --reason "stale leftover"';
  const close = 'node G:/WorkSpace/designli/ops/bin/mesa review close rv_1 --reason "stale card"';
  assert.equal(await rule(sh(mate(), withdraw)), "G4");
  assert.equal(await rule(sh(mate(), close)), "G4");
  assert.equal(await rule(sh(lead, withdraw)), null);
  assert.equal(await rule(sh(lead, close)), null);
  // a teammate may still read a review
  assert.equal(await rule(sh(mate(), "node G:/WorkSpace/designli/ops/bin/mesa review show rv_1")), null);
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
      ["mcp__claude_ai_Slack__slack_send_message_draft", { channel_id: "C1", message: "hola" }],
      ["mcp__claude_ai_Slack__slack_add_reaction", { name: "eyes" }],
      ["mcp__basecamp__create_comment", { content: "hola" }],
      ["mcp__basecamp__trash_comment", { id: 1 }],
      ["mcp__basecamp__create_campfire_line", { content: "hola" }],
    ]) {
      const r = await sbx(who, tool, input, released.fetchImpl);
      assert.equal(r?.rule, "G11", tool);
      assert.match(r.reason, NADA);
      assert.match(r.reason, /mesa salida sent <id> --simulated/);
      assert.match(r.reason, /mesa salida drafted <id> --simulated/);
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
  const d = await sbxSh(lead, "node G:/WorkSpace/designli/ops/bin/mesa salida drafted s1");
  assert.equal(d?.rule, "G11");
  assert.match(d.reason, /drafted <id> --simulated/);
  assert.equal(await rule(sbxSh(lead, "node G:/WorkSpace/designli/ops/bin/mesa salida drafted s1 --simulated")), null);
  assert.equal(await rule(sbxSh(mate(), "node G:/WorkSpace/designli/ops/bin/mesa salida drafted s1 --simulated")), "G4");
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
        { id: "s1", source: "slack", releasedAt: "2026-11-03T20:00:00Z", approvedVersion: 1, sendMode: "send", versions: [{ n: 1, body: "hola Ana" }], destination: { kind: "slack_channel", channelId: "C1" } },
        { id: "g1", source: "github", releasedAt: "2026-11-03T20:00:00Z", destination: { kind: "github_review", repo: "a/b", pr: 1, event: "APPROVE", postAs: "x" } },
      ],
    },
  });
  assert.equal(await rule(live(lead, "mcp__claude_ai_Slack__slack_send_message", { channel_id: "C1", message: "hola Ana" }, salidas.fetchImpl)), null);
  assert.equal(await rule(live(lead, "mcp__claude_ai_Slack__slack_send_message_draft", { channel_id: "C1", message: "hola Ana" }, salidas.fetchImpl)), "G5");
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
