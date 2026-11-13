#!/usr/bin/env node
/**
 * pr-gh.mjs: the one place the PR review flow writes to GitHub.
 *
 * Why it exists: every write used to be assembled inline and its shape changed from call to call, sometimes with a
 * `cd ~ &&` in front, sometimes with a `GH_TOKEN=$(gh auth token -u <login>)` env prefix, sometimes with
 * `-f commit_id`. Permission rules match by prefix, so any of those variations breaks the match. A fixed argv0 stops
 * moving the target:
 *
 *   node <mesa-repo>/vendor/pr-gh.mjs approve <owner/repo> <pr>
 *
 * Everything fragile stays inside:
 *   - the active `gh` account is often not the one that can write to the organisation's repos, so every call uses
 *     the token of the configured login (MESA_GH_USER, see below);
 *   - REST, not `gh pr review`, which goes through GraphQL and 404s for the same reason.
 *
 * The login is MESA_GH_USER from the environment, else MESA_GH_USER from <mesa-repo>/.env.local. No default: a
 * write under the wrong account is worse than a refusal, so with neither set the script exits with a hint.
 *
 * Usage:
 *   node pr-gh.mjs whoami
 *   node pr-gh.mjs approve  <owner/repo> <pr> [commit_sha]
 *   node pr-gh.mjs review   <owner/repo> <pr> <APPROVE|REQUEST_CHANGES|COMMENT> <payload.json>
 *   node pr-gh.mjs reply    <owner/repo> <pr> <in_reply_to_id> <body.txt>
 *
 * `review` reads a JSON file: { "body": "...", "commit_id": "...",
 *   "comments": [ { "path": "...", "line": 12, "body": "..." } ] }
 * Whatever the file does not carry is not sent.
 *
 * Each command prints one JSON line on stdout. Exit 0 = the write landed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com';

function die(msg, extra = {}) {
  console.log(JSON.stringify({ ok: false, error: msg, ...extra }));
  process.exit(1);
}

// MESA_GH_USER from the process env, else from the Mesa checkout's .env.local (one level up from vendor/).
function account() {
  const fromEnv = (process.env.MESA_GH_USER ?? '').trim();
  if (fromEnv) return fromEnv;
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?MESA_GH_USER\s*=\s*(.*?)\s*$/.exec(line);
      if (m) {
        const v = m[1].replace(/^(['"])(.*)\1$/, '$2').trim();
        if (v) return v;
      }
    }
  }
  return die('MESA_GH_USER is not set', {
    hint: 'set MESA_GH_USER to the GitHub login that reviews (env var or a line in the Mesa checkout\'s .env.local)',
  });
}

function token() {
  const ACCOUNT = account();
  try {
    return execFileSync('gh', ['auth', 'token', '-u', ACCOUNT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    die(`could not read the token of ${ACCOUNT} from gh`, {
      hint: 'gh auth status: the account has to stay logged in',
      detail: String(e.stderr || e.message).trim().slice(0, 300),
    });
  }
}

function splitRepo(slug) {
  const [owner, repo] = String(slug || '').split('/');
  if (!owner || !repo) die(`expected <owner/repo>, got "${slug}"`);
  return { owner, repo };
}

function headers() {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'mesa-pr-gh',
  };
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok) die(`GitHub ${res.status} on ${path}`, { message: json.message, errors: json.errors });
  return json;
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'whoami') {
  // Read only: proves the token works without writing anything.
  const res = await fetch(`${API}/user`, { headers: headers() });
  const me = await res.json();
  if (!res.ok) die(`GitHub ${res.status} on /user`, { message: me.message });
  console.log(JSON.stringify({ ok: true, login: me.login }));
  process.exit(0);
}

if (cmd === 'approve') {
  const [slug, pr, sha] = rest;
  const { owner, repo } = splitRepo(slug);
  if (!pr) die('missing <pr>');
  // Empty body on purpose: the pr-review skill approves without text, and a published nit invites a push that
  // dismiss_stale turns back into a pending approval.
  const body = { event: 'APPROVE', body: '' };
  if (sha) body.commit_id = sha;
  const out = await post(`/repos/${owner}/${repo}/pulls/${pr}/reviews`, body);
  console.log(JSON.stringify({ ok: true, action: 'approve', id: out.id, state: out.state, commit_id: out.commit_id }));
  process.exit(0);
}

if (cmd === 'review') {
  const [slug, pr, event, file] = rest;
  const { owner, repo } = splitRepo(slug);
  if (!pr) die('missing <pr>');
  if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) die(`invalid event "${event}"`);
  if (!file) die('missing <payload.json>');
  let payload;
  try { payload = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { die(`cannot read ${file}: ${e.message}`); }
  const body = { event };
  if (typeof payload.body === 'string') body.body = payload.body;
  if (payload.commit_id) body.commit_id = payload.commit_id;
  if (Array.isArray(payload.comments) && payload.comments.length) body.comments = payload.comments;
  const out = await post(`/repos/${owner}/${repo}/pulls/${pr}/reviews`, body);
  console.log(JSON.stringify({
    ok: true, action: 'review', event, id: out.id, state: out.state,
    commentIds: (out.comments || []).map((c) => c.id),
  }));
  process.exit(0);
}

if (cmd === 'reply') {
  const [slug, pr, inReplyTo, file] = rest;
  const { owner, repo } = splitRepo(slug);
  if (!pr) die('missing <pr>');
  if (!inReplyTo) die('missing <in_reply_to_id>');
  if (!file) die('missing <body.txt>');
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { die(`cannot read ${file}: ${e.message}`); }
  const out = await post(`/repos/${owner}/${repo}/pulls/${pr}/comments`, {
    body: text,
    in_reply_to: Number(inReplyTo),
  });
  console.log(JSON.stringify({ ok: true, action: 'reply', id: out.id, in_reply_to: Number(inReplyTo) }));
  process.exit(0);
}

die(`unknown command "${cmd ?? ''}"`, {
  usage: [
    'whoami',
    'approve <owner/repo> <pr> [sha]',
    'review <owner/repo> <pr> <APPROVE|REQUEST_CHANGES|COMMENT> <payload.json>',
    'reply <owner/repo> <pr> <in_reply_to> <body.txt>',
  ],
});
