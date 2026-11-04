#!/usr/bin/env node
// PreToolUse hook: mechanical rules for the Mesa team that do not depend on anyone remembering them.
// exit 2 = blocked (the reason on stderr is shown to the agent); exit 0 = allowed. Each rule cites the
// .claude/spawn-preamble.md rule it enforces.
//
//   G1 (rule 14) Chrome `navigate` without the tabId of a tab you created.
//   G2 (rule 5)  SendMessage to a retired agent (a message would resume it).
//   G3 (rule 5)  SendMessage over 12 non-empty lines (HANDOFF/BRIEF/SPAWN messages: 60), or an ack-only message.
//   G4 (rule 3)  Outward writes by a teammate: Slack sends, Basecamp writes, GitHub comments/reviews/merges,
//                pr-gh.mjs, `mesa salida sent`. Only the lead sends, and only after approval.
//   G5 (rule 3)  The lead's Slack / Basecamp message sends need a released salida in Mesa whose approved text is
//                the text being sent; its pr-gh.mjs writes need a released github salida for that repo and PR.
//                Mesa unreachable = blocked (nothing goes out unseen).
//   G10 (rule 3) Nobody approves, schedules, denies or undoes a salida, approves a plan or decides a permission
//                card through the raw API: those are Andrés's clicks.
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
import { hookSandbox, mesaCall, readStdinJson, resolveAgent } from "./lib.mjs";

const RETIRED_CACHE = join(tmpdir(), "mesa-team", "retired.json");

const SLACK_SEND = /^mcp__claude_ai_Slack__slack_(send_message|send_message_draft|schedule_message|create_canvas|update_canvas|add_reaction)$/;
const BASECAMP_WRITE =
  /^mcp__basecamp__(create|update|trash|delete|destroy|complete|uncomplete|move|archive|unarchive|pin|unpin|enable|disable|remove|reposition|reorder|subscribe|unsubscribe|watch|unwatch|toggle|pause|resume|copy|prioritize|deprioritize|set|mark|restore)_/;
// Sends whose text the lead may only post from a released salida.
const LEAD_TEXT_SENDS = /^(mcp__claude_ai_Slack__slack_send_message|mcp__basecamp__create_(comment|campfire_line|message|ping)|mcp__basecamp__update_(comment|message))$/;

const nonEmptyLines = (s) => s.split(/\r?\n/).filter((l) => l.trim()).length;

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

async function releasedSalidaMatches(tool, ti, { fetchImpl, base }) {
  const source = tool.includes("Slack") ? "slack" : "basecamp";
  const data = await mesaCall("/api/salidas?status=sending", { fetchImpl, base, timeoutMs: 4000 });
  // Sample salidas ("Datos de muestra.") never match: they can never be sent.
  const list = (data.salidas ?? data ?? []).filter((s) => s.source === source && (s.releasedAt ?? s.released_at) && !s.isSample);
  const want = tokens(sentText(ti)).join(" ");
  for (const item of list) {
    let s = item;
    if (approvedBody(s) === null) {
      const full = await mesaCall(`/api/salidas/${encodeURIComponent(item.id)}`, { fetchImpl, base, timeoutMs: 4000 });
      s = full.salida ?? full;
    }
    const body = approvedBody(s);
    if (body !== null && tokens(body).join(" ") === want) return s;
  }
  return null;
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
  if (SLACK_SEND.test(tool) || BASECAMP_WRITE.test(tool)) {
    return `${NADA} ${tool} writes to ${tool.includes("Slack") ? "Slack" : "Basecamp"}. On salida.released, report the send as simulated (\`mesa salida sent <id> --simulated\`) and never call the MCP tool; a delete is \`mesa salida deleted <id>\` alone.`;
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

  if (sandbox) {
    const why = sandboxBlock(tool, ti);
    if (why) return block("G11", why);
  }

  if (teammate && (SLACK_SEND.test(tool) || BASECAMP_WRITE.test(tool))) {
    return block("G4", `rule 3: ${agent.name} cannot write to Slack or Basecamp. Propose a salida (\`mesa salida propose ...\`) or a planned action and let the lead send it after Andrés approves.`);
  }

  if (!teammate && LEAD_TEXT_SENDS.test(tool)) {
    let match;
    try {
      match = await releasedSalidaMatches(tool, ti, { fetchImpl, base });
    } catch (err) {
      return block("G5", `rule 3: Mesa is unreachable (${err.message}), so this send cannot be matched to an approved salida. Nothing goes out unseen: wait for Mesa and send on salida.released.`);
    }
    if (!match) {
      return block("G5", "rule 3: no released salida in Mesa has exactly this text. Send only on `salida.released`, with the approved version's text unchanged (the 20 s undo window must be over).");
    }
  }
  if (tool === "mcp__claude_ai_Slack__slack_schedule_message") {
    return block("G5", "rule 3: Mesa schedules sends (Programar). Send with slack_send_message when Mesa emits salida.released.");
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
    if (/(127\.0\.0\.1|localhost|\[::1\]):(8790|8796)\/api\//.test(cmd) && /\/transition\b|\/plan\/approve\b|\/approvals\/[^/\s"']+\/decision\b|\/reviews\/[^/\s"']+\/actions\b|\/select\b|\/edit\b/.test(cmd) && /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|fetch)\b/i.test(cmd)) {
      return block("G10", "rule 3: approvals, plan approvals and permission decisions are Andrés's, in the Mesa UI. Use the mesa CLI verbs (propose, version, sent, failed) and wait for the wake event.");
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
      if (/\bmesa\b[^\n|;&]*\bsalida\s+(sent|failed|hold|bounce|deleted|restored)\b/.test(c)) {
        return block("G4", "rule 3: only the lead reports a salida as sent, failed, held, bounced, deleted or restored.");
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
