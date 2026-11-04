import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRow, fromRows, insertSql, newId, NotFoundError, nowIso, toAssignments } from "../db/util";
import type { Item, Source, Station, SyncState, Task, TaskOwner, TicketStatus } from "../domain/types";
import { TASK_IGNORED, TASK_KEY } from "./ignored";
import { touchInteraction } from "./interaction";

const SPEC = { bool: ["is_sample"] };

export interface TaskInput {
  title: string;
  source: Source;
  excerpt?: string;
  project?: string;
  station?: Station;
  waitOn?: string;
  position?: number;
  isSample?: boolean;
  /** Items to link to this task (their station follows the task). */
  itemIds?: string[];
}

export interface TaskPatch {
  title?: string;
  excerpt?: string;
  project?: string;
  source?: Source;
  waitOn?: string;
  position?: number;
}

export interface SyncPatch {
  ghItemId?: string | null;
  ghContentUrl?: string | null;
  syncState: SyncState;
  syncError?: string | null;
}

/** One card's station before a batch move, so Deshacer can put it back. */
export interface StationMove {
  id: string;
  station: Station;
}

export function tasksRepo(db: Db) {
  const ownerOf = (ticketId: string | null): TaskOwner | null => {
    if (!ticketId) return null;
    const t = db.prepare("SELECT id, ref, status FROM tickets WHERE id = ?").get(ticketId) as { id: string; ref: string; status: TicketStatus } | undefined;
    if (!t) return null;
    const a = db
      .prepare("SELECT name, role FROM ticket_team WHERE ticket_id = ? AND owner = 1 AND status = 'live' ORDER BY spawned_at DESC LIMIT 1")
      .get(t.id) as { name: string; role: string } | undefined;
    return { ticketId: t.id, ticketRef: t.ref, ticketStatus: t.status, agent: a?.name ?? null, role: a?.role ?? null };
  };

  const linked = (taskId: string) =>
    fromRows<Pick<Item, "id" | "source" | "title" | "url" | "project">>(
      db.prepare("SELECT id, source, title, url, project FROM items WHERE task_id = ? ORDER BY received_at").all(taskId),
    );

  const get = (id: string): Task => {
    const row = db.prepare(`SELECT *, ${TASK_KEY("tasks")} AS project_key FROM tasks WHERE id = ?`).get(id);
    if (!row) throw new NotFoundError("task", id);
    const t = fromRow<Task>(row, SPEC);
    return { ...t, items: linked(id), owner: ownerOf(t.ticketId) };
  };

  const link = (taskId: string, itemIds: string[], station: Station, ts: string) => {
    for (const itemId of itemIds) {
      const r = db
        .prepare("UPDATE items SET task_id = ?, station = ?, updated_at = ? WHERE id = ?")
        .run(taskId, station, ts, itemId);
      if (!r.changes) throw new NotFoundError("item", itemId);
    }
  };

  const moveOne = (id: string, station: Station, position: number | undefined, ts: string) => {
    db.prepare(
      "UPDATE tasks SET station = ?, position = COALESCE(?, position), sync_state = 'pending', sync_error = NULL, updated_at = ? WHERE id = ?",
    ).run(station, position ?? null, ts, id);
    db.prepare("UPDATE items SET station = ?, updated_at = ? WHERE task_id = ?").run(station, ts, id);
  };

  const restoreOrMove = (moves: StationMove[], now: Date) => {
    const ts = nowIso(now);
    const unique = [...new Map(moves.map((m) => [m.id, m])).values()];
    const previous = tx(db, () => {
      const prev: StationMove[] = [];
      for (const m of unique) {
        const cur = get(m.id); // throws NotFoundError: the whole batch rolls back
        prev.push({ id: m.id, station: cur.station });
        if (cur.station !== m.station) moveOne(m.id, m.station, undefined, ts);
      }
      touchInteraction(db, now);
      return prev;
    });
    return { tasks: unique.map((m) => get(m.id)), previous };
  };

  return {
    get,

    /** ignored: tasks of ignored projects, "include" (default), "exclude" (Tablero) or "only". */
    list(f: { station?: Station; source?: Source; ignored?: "include" | "exclude" | "only" } = {}): Task[] {
      const where: string[] = [];
      const args: string[] = [];
      if (f.station) {
        where.push("station = ?");
        args.push(f.station);
      }
      if (f.source) {
        where.push("source = ?");
        args.push(f.source);
      }
      if (f.ignored === "exclude") where.push(`NOT ${TASK_IGNORED("tasks")}`);
      if (f.ignored === "only") where.push(TASK_IGNORED("tasks"));
      const rows = db
        .prepare(`SELECT *, ${TASK_KEY("tasks")} AS project_key FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY station, position, created_at`)
        .all(...args);
      return fromRows<Task>(rows, SPEC).map((t) => ({ ...t, items: linked(t.id), owner: ownerOf(t.ticketId) }));
    },

    create(input: TaskInput, now = new Date()): Task {
      const id = newId("ta");
      const ts = nowIso(now);
      const { itemIds = [], ...rest } = input;
      const station = rest.station ?? "inbox";
      tx(db, () => {
        const { sql, values } = insertSql(
          "tasks",
          { id, ...rest, station, syncState: "pending", createdAt: ts, updatedAt: ts },
          SPEC,
        );
        db.prepare(sql).run(...values);
        link(id, itemIds, station, ts);
      });
      return get(id);
    },

    update(id: string, patch: TaskPatch, now = new Date()): Task {
      get(id);
      const { sql, values } = toAssignments({ ...patch, syncState: "pending", updatedAt: nowIso(now) }, SPEC);
      db.prepare(`UPDATE tasks SET ${sql} WHERE id = ?`).run(...values, id);
      return get(id);
    },

    /**
     * Move a card to a station. Linked items follow. The card shows
     * "Sin sincronizar" (sync_state = pending) until the GitHub Project write is acked.
     * `system`: Mesa moved it (the ticket's status drives its card), so it is not an Andrés interaction.
     */
    move(id: string, station: Station, position?: number, now = new Date(), o: { system?: boolean } = {}): Task {
      tx(db, () => {
        get(id);
        moveOne(id, station, position, nowIso(now));
        if (!o.system) touchInteraction(db, now);
      });
      return get(id);
    },

    /**
     * Move several cards in one transaction (Tablero batch "Mover a"). Every card goes back to
     * "Sin sincronizar" and through the GitHub Project push on its own, so one failed write
     * flags only that card. Returns each card's previous station for Deshacer.
     */
    moveMany(ids: string[], station: Station, now = new Date()): { tasks: Task[]; previous: StationMove[] } {
      return restoreOrMove(ids.map((id) => ({ id, station })), now);
    },

    /** Deshacer of a batch move: put each card back on its own station, in one transaction. */
    restore(moves: StationMove[], now = new Date()): { tasks: Task[]; previous: StationMove[] } {
      return restoreOrMove(moves, now);
    },

    linkItems(id: string, itemIds: string[], now = new Date()): Task {
      const t = get(id);
      tx(db, () => link(id, itemIds, t.station, nowIso(now)));
      return get(id);
    },

    /** Record the result of a GitHub Project write (lane C sync worker). */
    markSync(id: string, p: SyncPatch, now = new Date()): Task {
      get(id);
      const ts = nowIso(now);
      const { sql, values } = toAssignments({
        ...p,
        syncError: p.syncState === "error" ? (p.syncError ?? "unknown error") : null,
        syncedAt: p.syncState === "synced" ? ts : undefined,
      });
      db.prepare(`UPDATE tasks SET ${sql} WHERE id = ?`).run(...values, id);
      return get(id);
    },

    /** Tasks waiting for a GitHub Project write. Tasks of ignored projects are never pushed. */
    pendingSync(): Task[] {
      return fromRows<Task>(db.prepare(`SELECT * FROM tasks WHERE sync_state = 'pending' AND NOT ${TASK_IGNORED("tasks")} ORDER BY updated_at`).all(), SPEC);
    },

    remove(id: string): void {
      const r = db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
      if (!r.changes) throw new NotFoundError("task", id);
    },
  };
}
