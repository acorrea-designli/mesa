import { getDb, type Db } from "../db/sqlite";
import { STATIONS, type Counts, type Station } from "../domain/types";
import { emitWake } from "../wake/wake";
import { agentsRepo } from "./agents";
import { approvalsRepo } from "./approvals";
import { chipsRepo } from "./chips";
import { dispatchRepo } from "./dispatch";
import { engramRepo } from "./engram";
import { leadFocusRepo } from "./focus";
import { ignoredRepo, ITEM_IGNORED, TASK_IGNORED } from "./ignored";
import { lastInteractionAt, touchInteraction } from "./interaction";
import { pairingRepo } from "./pairing";
import { sourcesRepo } from "./sources";
import { itemsRepo } from "./items";
import { reviewsRepo } from "./reviews";
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
    dispatch: dispatchRepo(db),
    salidas: salidasRepo(db),
    chips: chipsRepo(db),
    sessions: sessionsRepo(db),
    engram: engramRepo(db),
    agents: agentsRepo(db),
    approvals: approvalsRepo(db),
    focus: leadFocusRepo(db),
    reviews: reviewsRepo(db),
    sources: sourcesRepo(db),
    ignored: ignoredRepo(db),
    pairing: pairingRepo(db),
    counts: () => counts(db),
    /** Time-driven transitions: salida undo windows, schedules, expiry; approval expiry. */
    sweep: (now = new Date()) => {
      salidasRepo(db).sweep(now);
      approvalsRepo(db).expire(now);
    },
    /** "Barrer ahora": wake the sweeper session so it runs a full sweep now, ignoring backoff. */
    requestSweep: (sources: string[] = ["slack", "basecamp"], now = new Date()) => {
      touchInteraction(db, now);
      return emitWake(db, { sessionId: sweeperSession(), kind: "sweep.requested", entityType: "sweep", entityId: "sweep", payload: { sources } }, now);
    },
    lastInteractionAt: () => lastInteractionAt(db),
  };
}

/** The stable session that owns every ticket and relays wakes to agents. */
export const leadSession = () => process.env.MESA_LEAD_SESSION ?? "lead";

/** The session that runs the Slack/Basecamp sweep tick (scripts/sweep-tick.mjs). */
export const sweeperSession = () => process.env.MESA_SWEEPER_SESSION ?? "sweeper";

export type Repos = ReturnType<typeof createRepos>;

const g = globalThis as unknown as { __mesaRepos?: Repos };

/** Repositories over the app's shared connection. */
export function repos(): Repos {
  if (!g.__mesaRepos) g.__mesaRepos = createRepos(getDb());
  return g.__mesaRepos;
}

/** Rail and band counts. Items and tasks of ignored projects are left out (salidas are not). */
function counts(db: Db, now = new Date()): Counts {
  const n = (sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const stations = Object.fromEntries(STATIONS.map((s) => [s, 0])) as Record<Station, number>;
  for (const r of db.prepare(`SELECT station, COUNT(*) AS n FROM items WHERE NOT ${ITEM_IGNORED("items")} GROUP BY station`).all() as { station: Station; n: number }[]) {
    stations[r.station] = r.n;
  }
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  return {
    hoy: stations.inbox,
    tablero: n(`SELECT COUNT(*) AS n FROM tasks WHERE station <> 'done' AND NOT ${TASK_IGNORED("tasks")}`),
    tickets: n("SELECT COUNT(*) AS n FROM tickets WHERE status <> 'closed'"),
    salidas: n("SELECT COUNT(*) AS n FROM salidas WHERE status IN ('pending','scheduled','queued_until_back')"),
    approvals: n("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'"),
    doneToday: n(`SELECT COUNT(*) AS n FROM items WHERE station = 'done' AND updated_at >= ? AND NOT ${ITEM_IGNORED("items")}`, dayStart.toISOString()),
    stations,
  };
}
