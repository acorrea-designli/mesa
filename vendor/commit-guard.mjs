#!/usr/bin/env node
// PreToolUse hook (Bash|PowerShell): enforces the team's commit rules mechanically, because a rule in memory only
// works if someone reads it.
//   - `git commit` must carry exactly one `-m "<msg>"` (single line, no body, no editor, no -F / heredoc).
//   - The message must be a conventional commit: `type(scope): subject`, lowercase subject, no trailing period,
//     at most 72 characters.
//   - No attribution of any kind: Co-Authored-By, "Generated with", Claude/Anthropic signatures, robot emoji.
//   - `gh pr create|edit` and `gh pr comment` / `gh issue comment` bodies carry no AI attribution either.
// exit 2 blocks the call and shows stderr to the agent. Anything this hook cannot parse passes (exit 0), so it
// never blocks unrelated commands.
import { readFileSync } from 'node:fs';

const TYPES = ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci', 'style', 'revert'];
export const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9._/-]+\\))?!?: [a-z0-9\`].*[^.\\s]$`);
const ATTRIBUTION = /co-authored-by|generated with|claude code|anthropic|noreply@anthropic|🤖/i;

// Split a shell line into tokens, honoring single and double quotes (enough for -m "…" detection).
export function tokenize(cmd) {
  const out = [];
  let cur = '';
  let q = null;
  let has = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < cmd.length && '"\\$`'.includes(cmd[i + 1])) cur += cmd[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    if (c === ';' || c === '|' || c === '&') { if (cur || has) out.push(cur); out.push(c); cur = ''; has = false; continue; }
    cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

// Returns an error string, or null when the command is fine.
export function check(command) {
  const cmd = String(command || '');
  if (!/\bgit\b/.test(cmd) && !/\bgh\b/.test(cmd)) return null;

  // gh bodies: no AI attribution in PRs, PR comments or issue comments.
  if (/\bgh\s+(pr\s+(create|edit|comment|review)|issue\s+(create|comment))\b/.test(cmd) && ATTRIBUTION.test(cmd)) {
    return 'GitHub text must not carry AI attribution (Co-Authored-By, "Generated with Claude Code", Anthropic, 🤖). Remove it and retry.';
  }

  const toks = tokenize(cmd);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] !== 'git') continue;
    // Find the subcommand after git's global options (-c k=v, -C dir, --git-dir=…).
    let j = i + 1;
    while (j < toks.length && toks[j].startsWith('-')) j += (toks[j] === '-c' || toks[j] === '-C') ? 2 : 1;
    if (toks[j] !== 'commit') continue;
    const args = [];
    for (let k = j + 1; k < toks.length && !';|&'.includes(toks[k]); k++) args.push(toks[k]);

    const msgs = [];
    let file = false;
    let reuse = false;
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (a === '-m' || a === '--message') msgs.push(args[++k] ?? '');
      else if (a.startsWith('--message=')) msgs.push(a.slice(10));
      else if (/^-[a-zA-Z]*m$/.test(a) && a.length > 2) msgs.push(args[++k] ?? ''); // -am "msg"
      else if (/^-m./.test(a)) msgs.push(a.slice(2));
      else if (a === '-F' || a === '--file' || a.startsWith('--file=') || a === '-t' || a === '--template') file = true;
      else if (a === '--no-edit' || a === '-C' || a === '--reuse-message' || a.startsWith('--reuse-message=') || a.startsWith('--fixup') || a.startsWith('--squash')) reuse = true;
    }
    if (ATTRIBUTION.test(cmd)) return 'Commit must not carry attribution (no Co-Authored-By, no "Generated with", no Claude/Anthropic signature). Use a single-line message only.';
    if (file) return 'Commit messages come from one `-m "type(scope): subject"` only. No -F/--file/--template and no heredoc.';
    if (msgs.length === 0) {
      if (reuse) return null; // --amend --no-edit, --fixup: no new message is written
      return 'git commit needs exactly one `-m "type(scope): subject"` (no editor).';
    }
    if (msgs.length > 1) return 'Single-line commits only: use one -m. No body, no second -m, no trailers.';
    const m = msgs[0];
    if (/[\r\n]/.test(m) || /\$\(|<</.test(m)) return 'Single-line commits only: no line breaks, no body, no heredoc or $(…) message.';
    if (m.length > 72) return `Commit subject is ${m.length} chars; keep it at 72 or fewer.`;
    if (!CONVENTIONAL.test(m)) return `Not a conventional commit: "${m}". Use \`type(scope): subject\` with type in ${TYPES.join('|')}, a lowercase imperative subject, no trailing period.`;
  }
  return null;
}

const isMain = process.argv[1] && import.meta.url.toLowerCase().endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop().toLowerCase());
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const tool = String(input.tool_name || '');
  if (tool !== 'Bash' && tool !== 'PowerShell') process.exit(0);
  const err = check(input.tool_input?.command);
  if (err) { process.stderr.write(`BLOCKED by commit-guard: ${err}\n`); process.exit(2); }
  process.exit(0);
}
