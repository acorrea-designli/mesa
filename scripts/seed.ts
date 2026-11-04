// Insert sample data ("Datos de muestra.") into data/mesa.db (or MESA_DB).
// Usage: pnpm seed            reset previous samples, then insert them again
//        pnpm seed --reset    delete samples only (real rows are never touched)
//
// src/ imports its siblings without file extensions (bundler resolution), which plain
// `node --experimental-strip-types` cannot resolve. This in-thread resolve hook retries a
// failed relative import from a .ts file with ".ts" and "/index.ts", then loads src/.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const fromTs = context.parentURL?.endsWith(".ts") ?? false;
      if (!relative || !fromTs || (err as { code?: string }).code !== "ERR_MODULE_NOT_FOUND") throw err;
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

const { defaultDbPath, openDb } = await import("../src/lib/db/sqlite.ts");
const { createRepos } = await import("../src/lib/repo/index.ts");
const { resetSamples, seedSamples } = await import("../src/lib/seed/sample.ts");

const file = defaultDbPath();
const db = openDb(file); // applies pending migrations (0310 adds the sample flags)
const fmt = (o: object) =>
  Object.entries(o)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(", ");

if (process.argv.includes("--reset")) {
  console.log(`${file}: removed samples: ${fmt(resetSamples(db))}`);
} else {
  console.log(`${file}: seeded samples: ${fmt(seedSamples(createRepos(db)))}`);
}
db.close();
