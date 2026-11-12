#!/usr/bin/env node
// PreToolUse hook: mechanical rules for the Mesa team that do not depend on anyone remembering them.
// exit 2 = blocked (the reason on stderr is shown to the agent); exit 0 = allowed. Each rule cites the
// .claude/spawn-preamble.md rule it enforces.
//
//   G1 (rule 14) Chrome `navigate` without the tabId of a tab you created.
//   G2 (rule 5)  SendMessage to a retired agent (a message would resume it).
//   G3 (rule 5)  SendMessage over 12 non-empty lines (HANDOFF/BRIEF/SPAWN messages: 60), or an ack-only message.
//   G12 (rule 5) A teammate with role `reviewer` runs `mesa ticket reply` with a body over 2 non-empty lines, a
//                `path/file.ext:NN` reference or a 7-40 hex sha: the findings are on the review card, never again in
//                the reply (mesa-review § Ask). A body the command does not show (`--body -` fed by a pipe or a `<` file,
//                `--body` from a variable or `$(...)`) is blocked too: write it as a heredoc. The lead and every other
//                role are not affected.
//   G4 (rule 3)  Outward writes by a teammate: Slack sends, Basecamp writes, GitHub comments/reviews/merges,
//                pr-gh.mjs, `mesa salida sent`. Only the lead sends, and only after approval. `mesa salida withdraw` and
//                `mesa review close` (the lead's cleanup of stale salidas and review cards, t123) are the lead's too.
//   G5 (rule 3)  The lead's Slack / Basecamp message sends need a released salida in Mesa whose approved text is
//                the text being sent; its pr-gh.mjs writes need a released github salida for that repo and PR.
//                A Basecamp create_comment also needs its `mentions` ids to equal the salida's destination.mentions
//                (same set; none = none). A Slack salida carries the mode Andrés chose with his approval click:
//                slack_send_message_draft passes only for a released, unsent, non-sample Slack salida in mode draft, and
//                slack_send_message only for one in mode send ("Claude lo envía": the connector appends "Sent using
//                @Claude" and Andrés accepted that); either way with exactly the approved text and the salida's
//                channelId (and threadTs when it has one) as channel_id / thread_ts. The wrong tool for the mode is
//                refused with the right path: a draft is never sent, a direct send is never drafted.
//                A Google Calendar create_event (the connector, t112) passes only for a released, unsent, non-sample
//                `calendar` salida whose approved body (title, start, end, invitees, Meet, description: one field per
//                line, scripts/hooks/calendar-body.mjs) is exactly what the call writes; any other Google Calendar write
//                (update, delete, respond, move) is refused outright: Mesa only creates, and only from a released salida.
//                Mesa unreachable = blocked (nothing goes out unseen).
//   G10 (rule 3) Nobody approves (and so never picks the Slack mode), schedules, denies or undoes a salida, closes a
//                Slack draft as sent ("Ya lo envié"), approves a plan or decides a permission card through the raw
//                API: those are Andrés's clicks. The raw /reviews/:id/close route is blocked the same way (the lead
//                closes a card with `mesa review close`).
//   G6 (rule 8)  run_in_background for git, gh, tests or builds. Only `mesa wait` may run in the background.
//   G7 (rule 10) `gh pr create` without --draft, bare force push, --no-verify, `gh auth` changes.
//   G11 (rule 16) Sandbox (MESA_ENV=sandbox, or `--env sandbox` on the hook command), lead and teammates alike:
//                no Slack or Basecamp write, no pr-gh.mjs write, no gh write (api with a method or fields, pr, issue,
//                repo, release, workflow ...), no git push, no `mesa salida sent` without --simulated, and no call to
//                the live board on :8790. Live mode is unaffected. docs/SANDBOX.md.
//   (G9 retired: commit message shape and attribution belong to the global commit-guard hook,
//    C:/Users/z4yross/.claude/hooks/commit-guard.mjs.)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eventFromCall, eventMismatches, parseEventBody } from "./calendar-body.mjs";
import { hookSandbox, mesaCall, readStdinJson, resolveAgent } from "./lib.mjs";

const RETIRED_CACHE = join(tmpdir(), "mesa-team", "retired.json");

const SLACK_SEND = /^mcp__claude_ai_Slack__slack_(send_message|send_message_draft|schedule_message|create_canvas|update_canvas|add_reaction)$/;
const BASECAMP_WRITE =
  /^mcp__basecamp__(create|update|trash|delete|destroy|complete|uncomplete|move|archive|unarchive|pin|unpin|enable|disable|remove|reposition|reorder|subscribe|unsubscribe|watch|unwatch|toggle|pause|resume|copy|prioritize|deprioritize|set|mark|restore)_/;
// Sends whose text the lead may only post from a released salida. (The two Slack message tools have their own check below.)
const LEAD_TEXT_SENDS = /^(mcp__basecamp__create_(comment|campfire_line|message|ping)|mcp__basecamp__update_(comment|message))$/;
// Google Calendar through the claude.ai connector (mcp__claude_ai_Google_Calendar__<action>) or a self-hosted one
// (mcp__google-calendar__<action>). Reads (list, get, find free time) are open; every other action writes.
const GCAL = /^mcp__(?:claude_ai_)?google[_-]?calendar[^_]*__(.+)$/i;
// authenticate / complete_authentication are the connector's own sign-in (plan action 1): they write nothing to the calendar.
const GCAL_READ = /^(list|get|find|search|read|check|query|free|suggest|fetch|show|view|lookup|authenticate|complete[_-]?authentication)/i;
const GCAL_CREATE = /^(create|insert|add)[_-]?event$/i;
const gcalAction = (tool) => GCAL.exec(tool)?.[1] ?? null;
const isGcalWrite = (tool) => {
  const a = gcalAction(tool);
  return a !== null && !GCAL_READ.test(a);
};
const SLACK_SEND_MESSAGE = "mcp__claude_ai_Slack__slack_send_message";
const SLACK_SEND_DRAFT = "mcp__claude_ai_Slack__slack_send_message_draft";

const nonEmptyLines = (s) => s.split(/\r?\n/).filter((l) => l.trim()).length;

// G12: a `mesa ticket reply` and its body as the command text shows it (heredoc `--body - <<'EOF'`, PowerShell
// here-string, here-string piped into `--body -`, or a quoted `--body "..."` / `--body '...'`). `reply` is false when the
// command is not a ticket reply; `body` is null when it is one but the text does not show the body: fed to `--body -` by
// a pipe or a `<` file, taken from a variable, `$(...)` or a backtick expression, or not quoted at all.
// The reply is looked for on any line of the command, so a variable or a pipe set up on an earlier line does not hide
// it. A heredoc with an unquoted delimiter and a PowerShell @"..."@ here-string expand $(...), $VAR and backticks, so
// their text is not the body that will be sent when it has a $ or a backtick.
const EXPANDS = /[$`]/;
// Index of the first line that is a `mesa ticket reply`, or -1. Lines inside another command's heredoc or here-string
// body (a `mesa handoff`, `finding upsert` or `ticket brief` whose text mentions the reply command) are data, not commands,
// so they are skipped: a line that opens `<<X`, `<<'X'` or `@'` / `@"` at its end hides everything up to its terminator.
function findReplyLine(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/\bmesa\b[^\n|;&]*\bticket\s+reply\b/.test(line)) return i;
    const here = /(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_]\w*)\2/.exec(line);
    if (here) {
      const stop = (l) => (here[1] ? l.replace(/^\t+/, "") : l).trimEnd() === here[3];
      let j = i + 1;
      while (j < lines.length && !stop(lines[j] ?? "")) j++;
      i = j;
      continue;
    }
    const hs = /@(['"])\s*$/.exec(line);
    if (hs) {
      const close = new RegExp("^\\s*" + hs[1] + "@");
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j] ?? "")) j++;
      // PowerShell runs code after the closer on the same line (`'@; mesa ticket reply ...`), so scan the closer line.
      i = j - 1;
    }
  }
  return -1;
}
export function ticketReplyShape(cmd) {
  const text = String(cmd ?? "");
  const lines = text.split(/\r?\n/);
  const piped = /^\s*@(['"])\r?\n([\s\S]*?)\r?\n\1@\s*\|\s*(.*)$/m.exec(text);
  if (piped && /\bmesa\b[^\n|;&]*\bticket\s+reply\b[^\n]*--body[\s=]+-(\s|$)/.test(piped[3])) {
    return { reply: true, body: piped[1] === '"' && EXPANDS.test(piped[2]) ? null : piped[2] };
  }
  const at = findReplyLine(lines);
  if (at < 0) return { reply: false, body: null };
  // The statement is the reply line plus its continuation lines (a trailing backslash, or a backtick in PowerShell).
  let end = at;
  while (end < lines.length - 1 && /[\\`]\s*$/.test(lines[end] ?? "")) end++;
  const statement = lines.slice(at, end + 1).join(" ");
  const tail = lines.slice(at).join("\n");
  // Only a heredoc opened by the reply itself feeds its body: `cat <<'X' >f; mesa ticket reply ... "$(cat f)"` opens it for cat.
  const replyAt = statement.search(/\bmesa\b[^\n|;&]*\bticket\s+reply\b/);
  const here = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(statement.slice(Math.max(replyAt, 0)));
  if (here) {
    const rest = lines.slice(end + 1);
    const stop = rest.findIndex((l) => l.trim() === here[2]);
    const body = (stop < 0 ? rest : rest.slice(0, stop)).join("\n");
    return { reply: true, body: here[1] === "" && EXPANDS.test(body) ? null : body };
  }
  const hs = /--body[\s=]+(?:-\s+)?@(['"])\r?\n([\s\S]*?)\r?\n\s*\1@/.exec(tail);
  if (hs) return { reply: true, body: hs[1] === '"' && EXPANDS.test(hs[2]) ? null : hs[2] };
  const q = /--body[\s=]+(?:"((?:[^"\\]|\\[\s\S])*)"|'([^']*)')/.exec(tail);
  if (q) {
    // Inside double quotes a $ or a backtick is an expansion, so the text is not the body that will be sent.
    if (q[1] !== undefined && EXPANDS.test(q[1])) return { reply: true, body: null };
    return { reply: true, body: q[1] ?? q[2] ?? "" };
  }
  return { reply: true, body: null };
}

// The body of a `mesa ticket reply` the command text shows; null when it is not a ticket reply or the body is not visible.
export const ticketReplyBody = (cmd) => ticketReplyShape(cmd).body;

// Why a reviewer's ticket reply repeats the review card, or null when it is the one-line summary it should be.
export function reviewerReplyProblem(body) {
  const why = [];
  const n = nonEmptyLines(body);
  if (n > 2) why.push(`${n} non-empty lines (max 2)`);
  if (/[\w./\\-]*\w\.[A-Za-z][A-Za-z0-9]{0,5}:\d+\b/.test(body)) why.push("a path:line reference");
  if ((body.match(/\b[0-9a-f]{7,40}\b/g) ?? []).some((t) => /\d/.test(t) && /[a-f]/.test(t))) why.push("a commit sha");
  return why.length ? why.join(", ") : null;
}

// Text as a sequence of lowercase word tokens, ignoring markup, URLs and punctuation, so the approved Markdown and the
// HTML or mrkdwn a connector takes compare equal when the words are the same.
export function tokens(text) {
  return String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/https?:\/\/\S+/g, " ")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

const sentText = (ti) => [ti.message, ti.text, ti.content, ti.line, ti.body].filter((x) => typeof x === "string").join("\n");

async function retiredNames({ fetchImpl, base }) {
  try {
    const data = await mesaCall("/api/team?status=retired", { fetchImpl, base, timeoutMs: 3000 });
    const names = (data.agents ?? data.team ?? data ?? []).map((a) => (typeof a === "string" ? a : a.name)).filter(Boolean);
    try {
      mkdirSync(join(tmpdir(), "mesa-team"), { recursive: true });
      writeFileSync(RETIRED_CACHE, JSON.stringify(names));
    } catch {}
    return names;
  } catch {
    try {
      return JSON.parse(readFileSync(RETIRED_CACHE, "utf8"));
    } catch {
      return [];
    }
  }
}

function approvedBody(s) {
  if (typeof s.approvedBody === "string") return s.approvedBody;
  const n = s.approvedVersion ?? s.approved_version;
  const v = (s.versions ?? []).find((x) => x.n === n);
  return v?.body ?? null;
}

// The Basecamp person ids a salida's destination pings, sorted, as strings ([] = nobody).
function destinationMentionIds(s) {
  let d = s.destination ?? {};
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      d = {};
    }
  }
  return (d.mentions ?? []).map((m) => String(m?.id ?? m)).sort();
}

// The ids create_comment is about to ping (`mentions`: person ids), sorted, as strings.
const sentMentionIds = (ti) => (Array.isArray(ti.mentions) ? ti.mentions.map(String).sort() : []);

const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Returns { match, mismatch }: match is the released salida with exactly this text (and, for create_comment, exactly
// these mentions); mismatch is set when a salida has the text but other mentions.
async function releasedSalidaMatches(tool, ti, { fetchImpl, base }) {
  const source = tool.includes("Slack") ? "slack" : "basecamp";
  const data = await mesaCall("/api/salidas?status=sending", { fetchImpl, base, timeoutMs: 4000 });
  // Sample salidas ("Datos de muestra.") never match: they can never be sent.
  const list = (data.salidas ?? data ?? []).filter((s) => s.source === source && (s.releasedAt ?? s.released_at) && !s.isSample);
  const want = tokens(sentText(ti)).join(" ");
  const checkMentions = tool === "mcp__basecamp__create_comment";
  const got = sentMentionIds(ti);
  let mismatch = null;
  for (const item of list) {
    let s = item;
    if (approvedBody(s) === null) {
      const full = await mesaCall(`/api/salidas/${encodeURIComponent(item.id)}`, { fetchImpl, base, timeoutMs: 4000 });
      s = full.salida ?? full;
    }
    const body = approvedBody(s);
    if (body === null || tokens(body).join(" ") !== want) continue;
    if (!checkMentions) return { match: s, mismatch };
    const expected = destinationMentionIds(s);
    if (sameIds(expected, got)) return { match: s, mismatch };
    mismatch = { expected, got };
  }
  return { match: null, mismatch };
}

// The released calendar salida a create_event call is exactly: { match } or { mismatches } (the nearest one).
async function releasedCalendarSalida(ti, { fetchImpl, base }) {
  const data = await mesaCall("/api/salidas?status=sending", { fetchImpl, base, timeoutMs: 4000 });
  const list = (data.salidas ?? data ?? []).filter((s) => s.source === "calendar" && (s.releasedAt ?? s.released_at) && !s.isSample && !(s.sentAt ?? s.sent_at));
  const call = eventFromCall(ti);
  let near = null;
  for (const item of list) {
    let s = item;
    if (approvedBody(s) === null) {
      const full = await mesaCall(`/api/salidas/${encodeURIComponent(item.id)}`, { fetchImpl, base, timeoutMs: 4000 });
      s = full.salida ?? full;
    }
    const body = approvedBody(s);
    const parsed = body === null ? null : parseEventBody(body);
    if (!parsed?.ok) continue;
    const diff = eventMismatches(parsed.fields, call, slackDestination(s));
    if (!diff.length) return { match: s, id: s.id };
    if (!near || diff.length < near.mismatches.length) near = { id: s.id, mismatches: diff };
  }
  return { match: null, near };
}

const slackDestination = (s) => {
  const d = s.destination ?? {};
  if (typeof d !== "string") return d;
  try {
    return JSON.parse(d);
  } catch {
    return {};
  }
};

// The mode Andrés chose with his approval click; a salida released before modes existed carries none = draft (the default).
const slackMode = (s) => s.sendMode ?? s.send_mode ?? "draft";

const SLACK_TOOL_MODE = { [SLACK_SEND_DRAFT]: "draft", [SLACK_SEND_MESSAGE]: "send" };
const showTarget = (channel, thread) => `channel ${channel || "(none)"}${thread ? `, thread ${thread}` : ", no thread"}`;

// Returns { match, wrongMode, mismatch } for slack_send_message_draft / slack_send_message: match is a released, unsent,
// non-sample Slack salida in the mode this tool serves, with exactly this text and this channel_id (and thread_ts);
// wrongMode is one with this text and target but the other mode; mismatch is one with this text but another target.
async function releasedSlackSalida(tool, ti, { fetchImpl, base }) {
  const wantMode = SLACK_TOOL_MODE[tool];
  const data = await mesaCall("/api/salidas?status=sending", { fetchImpl, base, timeoutMs: 4000 });
  // Only `sending` + released salidas are listed: a draft_created or sent one is no longer open for a send. Samples never match.
  const list = (data.salidas ?? data ?? []).filter((s) => s.source === "slack" && (s.releasedAt ?? s.released_at) && !s.isSample);
  const want = tokens(sentText(ti)).join(" ");
  const channel = String(ti.channel_id ?? ti.channelId ?? "");
  const thread = String(ti.thread_ts ?? ti.threadTs ?? "");
  let wrongMode = null;
  let mismatch = null;
  for (const item of list) {
    let s = item;
    if (approvedBody(s) === null) {
      const full = await mesaCall(`/api/salidas/${encodeURIComponent(item.id)}`, { fetchImpl, base, timeoutMs: 4000 });
      s = full.salida ?? full;
    }
    const body = approvedBody(s);
    if (body === null || tokens(body).join(" ") !== want) continue;
    const d = slackDestination(s);
    const expected = { channel: String(d.channelId ?? ""), thread: String(d.threadTs ?? "") };
    if (!expected.channel || expected.channel !== channel || expected.thread !== thread) {
      mismatch = { id: s.id, expected, got: { channel, thread } };
      continue;
    }
    if (slackMode(s) !== wantMode) {
      wrongMode = s;
      continue;
    }
    return { match: s, wrongMode, mismatch };
  }
  return { match: null, wrongMode, mismatch };
}

function slackRefusal(tool, found) {
  const wantMode = SLACK_TOOL_MODE[tool];
  if (found.wrongMode) {
    const id = found.wrongMode.id;
    return wantMode === "draft"
      ? `rule 3: salida ${id} was approved as "Claude lo envía" (mode send), not as a draft. Send it with slack_send_message (the connector adds "Sent using @Claude", which Andrés accepted with that button), then \`mesa salida sent ${id} --permalink <url>\`.`
      : `rule 3: salida ${id} was approved as a draft (mode draft, the default): Andrés sends it himself. Create it with slack_send_message_draft (same channel_id, thread_ts and exact text), then \`mesa salida drafted ${id}\`. slack_send_message is only for a salida approved as "Claude lo envía"; never switch a draft to a send.`;
  }
  if (found.mismatch) {
    const { id, expected, got } = found.mismatch;
    return `rule 3: the text matches released Slack salida ${id} but the target does not. Its destination is ${showTarget(expected.channel, expected.thread)}; this call passes ${showTarget(got.channel, got.thread)}. Use the salida's destination.channelId as channel_id and its destination.threadTs as thread_ts (no thread_ts when it has none).`;
  }
  const which = wantMode === "draft" ? "mode draft (Aprobar)" : "mode send (Aprobar y que Claude lo envíe)";
  const other = wantMode === "draft" ? "slack_send_message_draft is only for" : "slack_send_message is only for";
  return `rule 3: no released, unsent Slack salida in ${which} has exactly this text. ${other} a released salida in that mode, on salida.released (Andrés approved it and the 20 s undo window is over), with the approved version's text unchanged. A salida already drafted or sent is done.`;
}

// A released GitHub salida for this repo and PR (approve, review and reply all go out as github salidas).
async function releasedGithubSalida(repo, pr, { fetchImpl, base }) {
  const data = await mesaCall("/api/salidas?status=sending", { fetchImpl, base, timeoutMs: 4000 });
  return (
    (data.salidas ?? data ?? []).find((s) => {
      const d = typeof s.destination === "string" ? JSON.parse(s.destination) : (s.destination ?? {});
      return s.source === "github" && !s.isSample && (s.releasedAt ?? s.released_at) && d.repo === repo && Number(d.pr) === Number(pr);
    }) ?? null
  );
}

// G11: what the sandbox never lets out, for the lead and every teammate. Returns a reason or null.
const NADA = "sandbox: nada sale de aquí.";
const GH_WRITE =
  /\bgh\s+(pr\s+(create|merge|review|comment|close|reopen|edit|ready|lock|unlock)|issue\s+(create|comment|close|reopen|edit|delete|transfer|pin|unpin|lock|unlock|develop)|repo\s+(create|edit|delete|fork|rename|archive|unarchive|sync|deploy-key|set-default)|release\s+(create|edit|delete|upload)|workflow\s+(run|enable|disable)|run\s+(rerun|cancel|delete)|label\s+(create|edit|delete|clone)|secret\s+(set|delete)|variable\s+(set|delete)|gist\s+(create|edit|delete)|project\s+(create|edit|delete|close|copy|item-add|item-create|item-edit|item-delete|item-archive|field-create|field-delete|link|unlink|mark-template)|cache\s+delete)\b/;
const GH_API_WRITE_FLAGS = /(?:^|\s)(?:-X|--method)[\s=]*(POST|PUT|PATCH|DELETE)\b|(?:^|\s)(?:-f|-F|--field|--raw-field|--input)\s/i;

export function sandboxBlock(tool, ti) {
  if (isGcalWrite(tool)) {
    return `${NADA} ${tool} writes to Google Calendar. On salida.released, report the event as simulated ("mesa salida sent <id> --simulated") and never call the MCP tool; reads (list, free time) are fine.`;
  }
  if (SLACK_SEND.test(tool) || BASECAMP_WRITE.test(tool)) {
    return `${NADA} ${tool} writes to ${tool.includes("Slack") ? "Slack" : "Basecamp"}. On salida.released, report the send as simulated (\`mesa salida sent <id> --simulated\`; a Slack salida in mode draft: \`mesa salida drafted <id> --simulated\`) and never call the MCP tool; a delete is \`mesa salida deleted <id>\` alone.`;
  }
  if (tool !== "Bash" && tool !== "PowerShell") return null;
  const cmd = String(ti.command ?? "");
  const c = cmd.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""'); // quoted text never matches a verb
  if (/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):8790\b/.test(cmd)) {
    return `${NADA} That call goes to the live board on :8790. This session works only against the sandbox board, http://127.0.0.1:8796 (MESA_URL); drop the override.`;
  }
  if (/pr-gh\.mjs\s+(approve|review|reply)\b/.test(c)) {
    return `${NADA} pr-gh.mjs writes to GitHub. Report each github salida as \`mesa salida sent <id> --simulated\` and record findings with \`mesa finding upsert\` (no ghCommentId).`;
  }
  if (GH_WRITE.test(c) || (/\bgh\s+api\b/.test(c) && GH_API_WRITE_FLAGS.test(c))) {
    return `${NADA} That gh command writes to GitHub. Reads (gh api GET, gh pr view/diff, gh search) are fine; a PR is a local branch: commit in your worktree and name the branch in the ticket (\`mesa handoff ... --branch <b>\`).`;
  }
  if (/\bgit\b[^\n|;&]*\bpush\b/.test(c)) {
    return `${NADA} git push publishes the branch. Keep it local in your worktree and name the branch in the ticket (\`mesa handoff ... --branch <b>\`); that branch is the PR.`;
  }
  if (/\bmesa\b[^\n|;&]*\bsalida\s+sent\b/.test(c) && !/--simulated\b/.test(c)) {
    return `${NADA} Nothing was really sent, so report it as \`mesa salida sent <id> --simulated\` (no --permalink); Mesa records sandbox://<source>/<id>.`;
  }
  if (/\bmesa\b[^\n|;&]*\bsalida\s+drafted\b/.test(c) && !/--simulated\b/.test(c)) {
    return `${NADA} No Slack draft was really created, so report it as \`mesa salida drafted <id> --simulated\`; Mesa records sandbox://slack/<id>.`;
  }
  return null;
}

// Returns null (allowed) or { rule, reason }.
export async function check(input, { fetchImpl = fetch, base, sandbox = hookSandbox() } = {}) {
  const tool = String(input?.tool_name ?? "");
  const ti = input?.tool_input ?? {};
  const agent = resolveAgent(input); // null = the lead
  const teammate = agent !== null;
  const block = (rule, reason) => ({ rule, reason });

  if (tool === "mcp__claude-in-chrome__navigate" && !ti.tabId) {
    return block("G1", "rule 14: `navigate` needs the tabId of a tab you created with tabs_create_mcp; a bare navigate takes someone else's tab.");
  }

  if (tool === "SendMessage") {
    const to = String(ti.to ?? "").trim();
    const retired = await retiredNames({ fetchImpl, base });
    if (to && retired.includes(to)) {
      return block("G2", `rule 5: ${to} is retired; a message would resume it. Send to the live owner of the ticket (\`mesa ticket context <ref>\` lists the team) or to team-lead.`);
    }
    const msg = typeof ti.message === "string" ? ti.message : "";
    const long = /^(HANDOFF|BRIEF|SPAWN)\b/.test(msg.trim());
    const limit = long ? 60 : 12;
    if (nonEmptyLines(msg) > limit) {
      return block("G3", `rule 5: message is ${nonEmptyLines(msg)} non-empty lines; limit ${limit}. Put detail in the ticket (brief, handoff, reply) and send one line pointing at it.`);
    }
    if (msg && msg.split(/\s+/).length <= 20 && /^(ack(nowledged)?|understood|noted|got it|ok(ay)?|thanks?( you)?|will do|on it|roger|entendido|recibido)\b/i.test(msg.trim())) {
      return block("G3", "rule 5: acknowledgement-only message. Send a message only when it changes the recipient's next action.");
    }
  }

  // G12 (rule 5): the review card already lists every finding; the reviewer's reply is one line (mesa-review § Ask).
  if (agent?.role === "reviewer" && (tool === "Bash" || tool === "PowerShell")) {
    const { reply, body } = ticketReplyShape(ti.command);
    if (reply && body === null) {
      return block("G12", "rule 5: a reviewer's ticket reply must show its body in the command so it can be checked (it is ONE line, mesa-review § Ask), and this one does not: `--body -` fed by a pipe or a `<` file, or `--body` taken from a variable or `$(...)`. Write it as a heredoc: `mesa ticket reply <ref> --body - <<'EOF'`, the one line, then `EOF` (PowerShell: `--body @'` ... `'@`).");
    }
    const why = body === null ? null : reviewerReplyProblem(body);
    if (why) {
      return block("G12", `rule 5: a reviewer's ticket reply is ONE line (mesa-review § Ask) and this one has ${why}. Findings, paths, lines and sha are already on the review card (\`mesa finding upsert\`); never repeat them in the reply. Allowed shape: "1 blocker, 2 nits: <the blocker in plain words>." A second line only for what the card cannot show (e.g. a merge order). Explain more: the long form goes into the finding's \`explanation\`, the reply is "Detalle en el hallazgo N de la tarjeta."`);
    }
  }

  if (sandbox) {
    const why = sandboxBlock(tool, ti);
    if (why) return block("G11", why);
  }

  if (teammate && isGcalWrite(tool)) {
    return block("G4", `rule 3: ${agent.name} cannot write to Google Calendar. Propose a calendar salida ("mesa salida propose --source calendar ...") and let the lead create the event after Andrés approves it.`);
  }

  if (teammate && (SLACK_SEND.test(tool) || BASECAMP_WRITE.test(tool))) {
    return block("G4", `rule 3: ${agent.name} cannot write to Slack or Basecamp. Propose a salida (\`mesa salida propose ...\`) or a planned action and let the lead send it after Andrés approves.`);
  }

  // The claude.ai Slack connector appends "Sent using @Claude" to every slack_send_message and has no param to turn it
  // off. Andrés chooses per salida (his approval click): a draft he sends himself (no footer) or "Claude lo envía"
  // (with the footer). Each tool passes only for a released salida in its own mode, with that exact text and target.
  if (!teammate && (tool === SLACK_SEND_DRAFT || tool === SLACK_SEND_MESSAGE)) {
    let found;
    try {
      found = await releasedSlackSalida(tool, ti, { fetchImpl, base });
    } catch (err) {
      return block("G5", `rule 3: Mesa is unreachable (${err.message}), so this Slack call cannot be matched to an approved salida. Nothing goes out unseen: wait for Mesa and act on salida.released.`);
    }
    if (!found.match) return block("G5", slackRefusal(tool, found));
  }

  if (!teammate && LEAD_TEXT_SENDS.test(tool)) {
    let found;
    try {
      found = await releasedSalidaMatches(tool, ti, { fetchImpl, base });
    } catch (err) {
      return block("G5", `rule 3: Mesa is unreachable (${err.message}), so this send cannot be matched to an approved salida. Nothing goes out unseen: wait for Mesa and send on salida.released.`);
    }
    if (!found.match && found.mismatch) {
      const show = (ids) => (ids.length ? ids.join(", ") : "none");
      return block("G5", `rule 3: the text matches a released salida but its mentions do not. The salida's destination.mentions are [${show(found.mismatch.expected)}] and this create_comment passes [${show(found.mismatch.got)}]: pass exactly the destination's person ids (numbers) as \`mentions\`, no more and no fewer, or fix the salida's destination first.`);
    }
    if (!found.match) {
      return block("G5", "rule 3: no released salida in Mesa has exactly this text. Send only on `salida.released`, with the approved version's text unchanged (the 20 s undo window must be over).");
    }
  }
  // Google Calendar: the lead creates an event only from a released calendar salida, with exactly its approved fields.
  if (!teammate && isGcalWrite(tool)) {
    if (!GCAL_CREATE.test(gcalAction(tool))) {
      return block("G5", `rule 3: ${tool} changes Andrés's Google Calendar. Mesa only creates events, and only from a released calendar salida (create_event on salida.released). Updates, deletes and answers to invitations are his to make in Google Calendar.`);
    }
    let found;
    try {
      found = await releasedCalendarSalida(ti, { fetchImpl, base });
    } catch (err) {
      return block("G5", `rule 3: Mesa is unreachable (${err.message}), so this event cannot be matched to an approved salida. Nothing goes out unseen: wait for Mesa and create it on salida.released.`);
    }
    if (!found.match) {
      return block("G5", found.near ? `rule 3: no released calendar salida is exactly this event. The nearest is ${found.near.id}; the call differs: ${found.near.mismatches.join("; ")}. Create the event with exactly the approved fields (the approved version's body), or propose a new version for Andrés to approve.` : "rule 3: no released calendar salida in Mesa matches this event. Create it only on `salida.released` (Andrés approved it and the 20 s undo window is over), then `mesa salida sent <id> --permalink <event link>`.");
    }
  }
  if (tool === "mcp__claude_ai_Slack__slack_schedule_message") {
    return block("G5", "rule 3: Mesa schedules sends (Programar); never schedule through the connector. At salida.released follow mesa-salida § Send (a Slack salida goes out as a draft or a direct send, per the mode in the event).");
  }

  if (tool === "Bash" || tool === "PowerShell") {
    const cmd = String(ti.command ?? "");
    const c = cmd.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""'); // quoted text never matches a verb

    const longRunning = /\bmesa\b[^\n|;&]*\bwait\b/.test(cmd) || /^\s*pnpm\s+(-C|--dir)\s+\S*designli[\\/]ops\S*\s+(start|dev)\s*$/.test(cmd);
    if (ti.run_in_background === true && !longRunning &&/\b(git|gh|vitest|jest|pnpm|npm|npx|node\s+--test|terraform|tofu)\b/.test(c)) {
      return block("G6", "rule 8: git, gh, tests and builds run in the FOREGROUND. Only `mesa wait` and the Mesa server (`pnpm -C G:/WorkSpace/designli/ops start`) run in the background.");
    }

    // G10 (rule 3): approving is Andrés's, in the Mesa UI. No session calls approve/schedule/deny/undo, approves a
    // plan or decides a permission card through the raw API (the CLI has no such verbs on purpose).
    if (/(127\.0\.0\.1|localhost|\[::1\]):(8790|8796)\/api\//.test(cmd) && /\/transition\b|\/plan\/approve\b|\/approvals\/[^/\s"']+\/(decision|approve|read-config|deny)\b|\/tickets\/[^/\s"']+\/permission-request\b|\/reviews\/[^/\s"']+\/(actions|close)\b|\/select\b|\/edit\b/.test(cmd) && /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|fetch)\b/i.test(cmd)) {
      return block("G10", "rule 3: approvals (and the Slack mode they carry), \"Ya lo envié\", plan approvals, permission decisions and Pídeme permiso are Andrés's, in the Mesa UI. Use the mesa CLI verbs (propose, version, sent, drafted, failed) and wait for the wake event.");
    }

    if (!teammate) {
      const w = /pr-gh\.mjs\s+(approve|review|reply)\s+(\S+)\s+(\d+)/.exec(c);
      if (w) {
        let s;
        try {
          s = await releasedGithubSalida(w[2], w[3], { fetchImpl, base });
        } catch (err) {
          return block("G5", `rule 3: Mesa is unreachable (${err.message}), so this GitHub write cannot be matched to an approved salida.`);
        }
        if (!s) {
          return block("G5", `rule 3: no released github salida for ${w[2]}#${w[3]}. GitHub writes go out only on salida.released (Andrés approved it and the 20 s undo window is over).`);
        }
      }
    }

    if (teammate) {
      if (/pr-gh\.mjs\s+(approve|review|reply)\b/.test(c)) {
        return block("G4", "rule 3: GitHub reviews and comments are the lead's to send, after Andrés presses Approve / Post in Mesa. Record findings in the ticket instead.");
      }
      if (/\bgh\s+pr\s+(review|comment|merge|close|reopen|edit|ready)\b|\bgh\s+issue\s+(comment|create|close|reopen|edit|delete)\b|\bgh\s+release\s+create\b/.test(c)) {
        return block("G4", "rule 3: that gh command writes to GitHub on Andrés's behalf. Only `gh pr create --draft` for your own branch is yours; everything else goes through the lead after approval.");
      }
      if (/\bmesa\b[^\n|;&]*\bsalida\s+(sent|drafted|failed|hold|bounce|deleted|restored|withdraw)\b/.test(c)) {
        return block("G4", "rule 3: only the lead reports a salida as sent, drafted, failed, held, bounced, deleted or restored, or withdraws one.");
      }
      if (/\bmesa\b[^\n|;&]*\breview\s+close\b/.test(c)) {
        return block("G4", "rule 3: only the lead closes a review card (`mesa review close`).");
      }
    }

    // Everyone: GitHub writes go only through pr-gh.mjs (the lead, after a click), so a raw `gh api` write is never right.
    if (/\bgh\s+api\b/.test(c) && /(?:^|\s)(?:-X|--method)[\s=]*(POST|PUT|PATCH|DELETE)\b|(?:^|\s)(?:-f|-F|--field|--raw-field|--input)\s/i.test(c)) {
      return block("G4", "rule 3: `gh api` is for GET reads only. GitHub writes go through pr-gh.mjs, run by the lead after Andrés clicks in Mesa.");
    }
    if (/\bgh\s+pr\s+create\b/.test(c) && !/--draft\b|(^|\s)-d(\s|$)/.test(c)) {
      return block("G7", "rule 10: open agent PRs as drafts (`gh pr create --draft ...`). Andrés decides when one is ready.");
    }
    if (/git\s+push\b[^\n|;&]*\s(--force|-f)(\s|$)/.test(c) && !/--force-with-lease/.test(c)) {
      return block("G7", "rule 10: bare `git push --force`. Use --force-with-lease on your own branch only.");
    }
    if (/--no-verify\b|\bgit\b[^\n|;&]*\bcommit\b[^\n|;&]*\s-(?!-)[a-zA-Z]*n\b/.test(c)) {
      return block("G7", "rule 10: never skip the commit hooks.");
    }
    if (/\bgh\s+auth\s+(switch|login|logout|refresh)\b/.test(c)) {
      return block("G7", "rule 10: `gh auth` changes are Andrés's. If the account is wrong, BLOCKED to team-lead.");
    }
    // Commit message shape and attribution are enforced by the global commit-guard hook
    // (C:/Users/z4yross/.claude/hooks/commit-guard.mjs), not here.
  }
  return null;
}

async function main() {
  let input;
  try {
    input = await readStdinJson();
  } catch {
    process.exit(0);
  }
  const r = await check(input).catch(() => null);
  if (r) {
    process.stderr.write(`BLOCKED by Mesa guardrail ${r.rule}: ${r.reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
