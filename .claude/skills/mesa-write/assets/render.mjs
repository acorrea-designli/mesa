#!/usr/bin/env node
// Renders a client document (HTML built from template.html) to PDF with Playwright's Chromium.
//
//   node render.mjs <input.html> [output.pdf] [--format Letter|A4] [--footer "Client · Document title"]
//
// Default output: the input path with .pdf. Default format: Letter (US clients); pass A4 when the client is not US.
// Playwright is a devDependency of this repo (`pnpm install`, then once `pnpm exec playwright install chromium`).
// It is found, in order: MESA_PLAYWRIGHT=<path to playwright's index.mjs>; MESA_REPO=<checkout>'s node_modules; the
// repo's own node_modules, walking up from this script (also an `ops/` folder next to an ancestor, which is how a
// copy under the team folder finds the checkout); last, the legacy checkout it used to be borrowed from.
// Prints one JSON line: { ok, pdf, bytes, pages } or { ok: false, error }.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LEGACY_PLAYWRIGHT =
  "G:/WorkSpace/lucitlabs/medix-platform/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

const pkgIndex = (root) => join(root, "node_modules", "playwright", "index.mjs");

// Every place Playwright's index.mjs may be, best first.
export function playwrightCandidates(env = process.env, scriptPath = fileURLToPath(import.meta.url)) {
  const out = [];
  if (env.MESA_PLAYWRIGHT) out.push(env.MESA_PLAYWRIGHT);
  if (env.MESA_REPO) out.push(pkgIndex(env.MESA_REPO));
  let dir;
  try {
    dir = dirname(realpathSync(scriptPath));
  } catch {
    dir = dirname(scriptPath);
  }
  for (let prev = ""; dir !== prev; prev = dir, dir = dirname(dir)) out.push(pkgIndex(dir), pkgIndex(join(dir, "ops")));
  out.push(LEGACY_PLAYWRIGHT);
  return out;
}

export function resolvePlaywright(env = process.env, scriptPath = fileURLToPath(import.meta.url), exists = existsSync) {
  if (env.MESA_PLAYWRIGHT) return env.MESA_PLAYWRIGHT; // an explicit override is trusted, so a bad path fails loudly
  const found = playwrightCandidates(env, scriptPath).find((c) => exists(c));
  if (!found) throw new Error("Playwright not found: run `pnpm install` in the Mesa checkout, or set MESA_PLAYWRIGHT=<path to playwright's index.mjs>");
  return found;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function args(argv) {
  const pos = [];
  const opt = { format: "Letter", footer: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--format") opt.format = argv[++i];
    else if (argv[i] === "--footer") opt.footer = argv[++i];
    else pos.push(argv[i]);
  }
  return { input: pos[0], output: pos[1], ...opt };
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.input) throw new Error("usage: node render.mjs <input.html> [output.pdf] [--format Letter|A4] [--footer TEXT]");
  const input = resolve(a.input);
  if (!existsSync(input)) throw new Error(`no such file: ${input}`);
  const output = resolve(a.output ?? input.replace(/\.html?$/i, "") + ".pdf");
  const html = readFileSync(input, "utf8");
  const left = /\{\{[A-Z0-9_]+\}\}/.exec(html);
  if (left) throw new Error(`unfilled placeholder ${left[0]} in ${input}`);
  const title = a.footer || (/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "");

  const { chromium } = await import(pathToFileURL(resolvePlaywright()).href);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(input).href, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: output,
      format: a.format,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        `<div style="width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:7.5pt;color:#8b919c;padding:0 16mm;">` +
        `<span style="float:left">${esc(title)}</span>` +
        `<span style="float:right"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close();
  }
  const pdf = readFileSync(output, "latin1");
  const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  process.stdout.write(`${JSON.stringify({ ok: true, pdf: output, bytes: statSync(output).size, pages })}\n`);
}

// Only when run as a script: the resolver above is imported by its test.
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: err.message })}\n`);
    process.exit(1);
  });
}
