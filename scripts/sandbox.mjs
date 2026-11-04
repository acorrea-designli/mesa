#!/usr/bin/env node
// pnpm sandbox: the sandbox board (docs/SANDBOX.md) on http://127.0.0.1:8796 over data/sandbox.db,
// with MESA_ENV=sandbox (nothing leaves it) and its own build folder, so it runs beside the live board
// on :8790. Create or refresh its database with `pnpm sandbox:reset [--from live|seed]` first.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(REPO, "data", "sandbox.db");
const PORT = "8796";

if (!existsSync(DB)) {
  console.error("sandbox: data/sandbox.db does not exist yet. Run `pnpm sandbox:reset` (a copy of the live board) or `pnpm sandbox:reset --from seed`.");
  process.exit(1);
}

const env = {
  ...process.env,
  MESA_ENV: "sandbox",
  MESA_DB: DB,
  MESA_GITHUB: "off",
  MESA_DIST_DIR: ".next-sandbox",
};
const next = join(REPO, "node_modules", "next", "dist", "bin", "next");
console.log(`sandbox: http://127.0.0.1:${PORT}  (MESA_ENV=sandbox, MESA_DB=data/sandbox.db)`);
const child = spawn(process.execPath, [next, "dev", "--hostname", "127.0.0.1", "--port", PORT], { cwd: REPO, env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
