import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check } from './commit-guard.mjs';

const ok = (c) => assert.equal(check(c), null, c);
const bad = (c) => assert.notEqual(check(c), null, c);

test('allows good commits', () => {
  ok('git commit -m "feat(board): add salida undo window"');
  ok('git -c user.name="x" -c user.email="y@z" commit -m "fix: handle empty queue"');
  ok("git add -A && git commit -m 'chore(deps)!: bump next to 16'");
  ok('git commit -am "refactor(api): split wait route"');
  ok('git commit --amend --no-edit');
  ok('git status && git log --oneline');
  ok('ls -la');
});

test('blocks attribution', () => {
  bad('git commit -m "feat: x" -m "Co-Authored-By: Claude <noreply@anthropic.com>"');
  bad('git commit -m "feat: add x 🤖"');
  bad('gh pr create --title "feat: x" --body "Summary\n\n🤖 Generated with Claude Code"');
  ok('gh pr create --title "feat: x" --body "Adds the undo window."');
});

test('blocks non conventional or multi-line', () => {
  bad('git commit -m "Add salida undo window"');
  bad('git commit -m "feat: Add thing"');
  bad('git commit -m "feat: add thing."');
  bad('git commit -m "feat: a" -m "body line"');
  bad('git commit -F msg.txt');
  bad('git commit');
  bad(`git commit -m "$(cat <<'EOF'\nfeat: x\n\nbody\nEOF\n)"`);
  bad('git commit -m "feat: ' + 'a'.repeat(80) + '"');
});

test('hook exit codes', () => {
  const hook = fileURLToPath(new URL('./commit-guard.mjs', import.meta.url));
  const run = (command) => spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }) });
  assert.equal(run('git commit -m "feat: ok"').status, 0);
  const r = run('git commit -m "Update stuff"');
  assert.equal(r.status, 2);
  assert.match(String(r.stderr), /BLOCKED by commit-guard/);
  assert.equal(spawnSync(process.execPath, [hook], { input: 'not json' }).status, 0);
});
