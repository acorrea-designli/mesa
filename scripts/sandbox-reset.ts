// pnpm sandbox:reset [--from live|seed] [--source data/mesa.db] [--target data/sandbox.db]
// Rebuilds the sandbox board's database (docs/SANDBOX.md). --from live (default) snapshots the live
// DB without locking or writing it; --from seed starts from the sample seed. Stop `pnpm sandbox` first.
import { registerHooks } from "node:module";
import path from "node:path";

// The in-thread resolve hook of scripts/seed.ts: src/ imports siblings without extensions and folders
// without /index (src/lib/sandbox/reset.ts imports "../repo").
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const fromTs = context.parentURL?.endsWith(".ts") ?? false;
      const code = (err as { code?: string }).code;
      if (!relative || !fromTs || (code !== "ERR_MODULE_NOT_FOUND" && code !== "ERR_UNSUPPORTED_DIR_IMPORT")) throw err;
      for (const suffix of [".ts", "/index.ts"]) {
        try {
          return nextResolve(specifier + suffix, context);
        } catch {
          // try the next suffix
        }
      }
      throw err;
    }
  },
});

const { resetSandbox } = await import("../src/lib/sandbox/reset.ts");

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : dflt;
};
const from = arg("from", "live");
if (from !== "live" && from !== "seed") {
  console.error(`sandbox:reset: --from must be live or seed, not ${from}`);
  process.exit(2);
}
const source = path.resolve(arg("source", process.env.MESA_LIVE_DB ?? path.join("data", "mesa.db")));
const target = path.resolve(arg("target", path.join("data", "sandbox.db")));
const port = Number(arg("port", "8796"));

// The sandbox server holds the file open; replacing it under a running server corrupts its view.
const running = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) }).then(
  (r) => r.ok,
  () => false,
);
if (running) {
  console.error(`sandbox:reset: the sandbox server is running on :${port}; stop \`pnpm sandbox\` first`);
  process.exit(1);
}

try {
  const copy = resetSandbox({ from, source: from === "live" ? source : undefined, target });
  const rows = ["items", "tasks", "tickets", "salidas", "reviews"].map((t) => `${t} ${copy.rows[t] ?? 0}`).join(", ");
  const s = copy.scrubbed;
  console.log(`${target}: from ${from}${copy.source ? ` (${copy.source}, read only)` : ""}`);
  console.log(`  rows: ${rows}`);
  console.log(
    `  scrubbed: ${s.wakeEvents} wake events, ${s.sessions} sessions, ${s.agentsRetired} live agents retired, ${s.salidasToPending} salidas back to pending, ${s.approvalsExpired} permission cards expired, ${s.tasksUnlinked} tasks unlinked from the GitHub Project${s.samplesUnflagged ? `, ${s.samplesUnflagged} sample rows made ordinary` : ""}`,
  );
  console.log("  start it with: pnpm sandbox   (http://127.0.0.1:8796)");
} catch (err) {
  console.error(`sandbox:reset: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
