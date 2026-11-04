#!/usr/bin/env node
// Renders a client document (HTML built from template.html) to PDF with Playwright's Chromium.
//
//   node render.mjs <input.html> [output.pdf] [--format Letter|A4] [--footer "Client · Document title"]
//
// Default output: the input path with .pdf. Default format: Letter (US clients); pass A4 when the client is not US.
// Playwright is not a dependency of this repo: it is imported from the medix checkout by file URL. Override the
// location with MESA_PLAYWRIGHT=<path to playwright's index.mjs>.
// Prints one JSON line: { ok, pdf, bytes, pages } or { ok: false, error }.
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PLAYWRIGHT =
  "G:/WorkSpace/lucitlabs/medix-platform/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

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

  const pw = process.env.MESA_PLAYWRIGHT ?? DEFAULT_PLAYWRIGHT;
  const { chromium } = await import(pathToFileURL(pw).href);
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

main().catch((err) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: err.message })}\n`);
  process.exit(1);
});
