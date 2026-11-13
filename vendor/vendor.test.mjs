// Scrub check for vendor/ and for the references Mesa's skills and agents hold to it. node:test, run by `pnpm test:team`.
// The patterns are assembled from fragments so this file does not contain the strings it forbids.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const j = (...p) => p.join("");

// Never in vendor/: identity, ids, clients, tokens, absolute profile or workspace paths.
const PERSONAL = [
  new RegExp(j("z4", "yross"), "i"),
  new RegExp(j("acor", "rea"), "i"),
  new RegExp(j("U06E", "2UBDC73")),
  new RegExp(j("med", "ix"), "i"),
  new RegExp(j("7-Ar", "row")),
  new RegExp(j("pros", "pec"), "i"),
  new RegExp(j("design", "li"), "i"),
  new RegExp(j("And", "r[eé]s"), "i"),
  /xox[abprs]-/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_/,
  /[A-Z]:[\\/]Users[\\/]/i,
  /[A-Z]:[\\/]WorkSpace/i,
  /\/home\/[a-z]/,
];

// Mesa skills, agents and the preamble keep canonical paths for the installer to render, but must not lean on
// anything in another person's Claude profile. (render.mjs alone keeps the legacy Playwright path, as its last fallback.)
const PROFILE_REFS = [
  new RegExp(j("z4", "yross"), "i"),
  new RegExp(j("\\.claude-work/(skills|commands|", "pr-gh)")),
  new RegExp(j("claude/hooks/", "commit-guard")),
  new RegExp(j("AppData/Local/", "(mise|pnpm)")),
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const textOnly = (f) => /\.(md|mjs|js|json|html|txt)$/.test(f);

test("vendor/ carries no personal identifier, id, token or absolute profile path", () => {
  const self = join(here, "vendor.test.mjs");
  const files = walk(here).filter((f) => f !== self && textOnly(f));
  assert.ok(files.length >= 5, "vendor/ is not empty");
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const re of PERSONAL) {
      const m = re.exec(text);
      if (m) hits.push(`${relative(repo, f)}: ${re} matches "${m[0]}"`);
    }
    // An email address, except the placeholders and the attribution the commit guard looks for.
    for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi)) {
      if (!/^(noreply@anthropic\.com|y@z\.\w+)$/i.test(m[0]) && m[0] !== "y@z") hits.push(`${relative(repo, f)}: email-like "${m[0]}"`);
    }
  }
  assert.deepEqual(hits, []);
});

test("the vendored files Mesa points at exist", () => {
  for (const f of ["pr-review/SKILL.md", "pr-gh.mjs", "pr-monitor.md", "slack-triage.md", "commit-guard.mjs"]) {
    assert.ok(existsSync(join(here, f)), `vendor/${f}`);
  }
});

test("Mesa skills, agents and the preamble reference vendor/, not another person's profile", () => {
  const roots = [join(repo, ".claude", "skills"), join(repo, ".claude", "agents")];
  const files = [join(repo, ".claude", "spawn-preamble.md"), ...roots.flatMap((r) => walk(r))].filter(textOnly);
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const re of PROFILE_REFS) {
      const m = re.exec(text);
      if (m) hits.push(`${relative(repo, f)}: ${re} matches "${m[0]}"`);
    }
    // The legacy Playwright location is the last fallback of render.mjs (and only there).
    if (!f.endsWith("render.mjs") && new RegExp(j("med", "ix-platform")).test(text)) hits.push(`${relative(repo, f)}: legacy checkout path`);
  }
  assert.deepEqual(hits, []);
});

test("pr-gh.mjs refuses to run without a configured login", async () => {
  const { spawnSync } = await import("node:child_process");
  const env = { ...process.env };
  delete env.MESA_GH_USER;
  const r = spawnSync(process.execPath, [join(here, "pr-gh.mjs"), "whoami"], { env, encoding: "utf8" });
  // A checkout whose own .env.local sets MESA_GH_USER (a real install) legitimately gets past the check.
  const envLocal = join(repo, ".env.local");
  const configured = existsSync(envLocal) && /^\s*(export\s+)?MESA_GH_USER\s*=\s*\S/m.test(readFileSync(envLocal, "utf8"));
  if (configured) return;
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(out.ok, false);
  assert.match(out.error, /MESA_GH_USER/);
});
