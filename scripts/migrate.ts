// Apply pending SQL migrations to data/mesa.db (or MESA_DB). Usage: pnpm db:migrate
import { defaultDbPath, openDb } from "../src/lib/db/sqlite.ts";

const file = defaultDbPath();
const db = openDb(file); // openDb applies pending migrations
const rows = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all() as { name: string }[];
console.log(`${file}: ${rows.map((r) => r.name).join(", ")}`);
