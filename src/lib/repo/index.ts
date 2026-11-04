import { getDb, type Db } from "../db/sqlite";
import { STATIONS, type Counts, type Station } from "../domain/types";
import { chipsRepo } from "./chips";
import { engramRepo } from "./engram";
import { itemsRepo } from "./items";
import { salidasRepo } from "./salidas";
import { sessionsRepo } from "./sessions";
import { tasksRepo } from "./tasks";
import { ticketsRepo } from "./tickets";

export function createRepos(db: Db) {
  return {
    db,
    items: itemsRepo(db),
    tasks: tasksRepo(db),
    tickets: ticketsRepo(db),
    salidas: salidasRepo(db),
    chips: chipsRepo(db),
    sessions: sessionsRepo(db),
    engram: engramRepo(db),
    counts: () => counts(db),
  };
}

export type Repos = ReturnType<typeof createRepos>;

const g = globalThis as unknown as { __mesaRepos?: Repos };

/** Repositories over the app's shared connection. */
export function repos(): Repos {
  if (!g.__mesaRepos) g.__mesaRepos = createRepos(getDb());
  return g.__mesaRepos;
}

function counts(db: Db, now = new Date()): Counts {
  const n = (sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const stations = Object.fromEntries(STATIONS.map((s) => [s, 0])) as Record<Station, number>;
  for (const r of db.prepare("SELECT station, COUNT(*) AS n FROM items GROUP BY station").all() as { station: Station; n: number }[]) {
    stations[r.station] = r.n;
  }
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  return {
    hoy: stations.inbox,
    tablero: n("SELECT COUNT(*) AS n FROM tasks WHERE station <> 'done'"),
    tickets: n("SELECT COUNT(*) AS n FROM tickets WHERE status <> 'closed'"),
    salidas: n("SELECT COUNT(*) AS n FROM salidas WHERE status IN ('pending','scheduled')"),
    doneToday: n("SELECT COUNT(*) AS n FROM items WHERE station = 'done' AND updated_at >= ?", dayStart.toISOString()),
    stations,
  };
}
