import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRow, fromRows, insertSql, newId, NotFoundError, nowIso, toAssignments } from "../db/util";
import type { Item, Source, Station, SyncState, Task } from "../domain/types";
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

export function tasksRepo(db: Db) {
  const linked = (taskId: string) =>
    fromRows<Pick<Item, "id" | "source" | "title" | "url" | "project">>(
      db.prepare("SELECT id, source, title, url, project FROM items WHERE task_id = ? ORDER BY received_at").all(taskId),
    );

  const get = (id: string): Task => {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!row) throw new NotFoundError("task", id);
    return { ...fromRow<Task>(row, SPEC), items: linked(id) };
  };

  const link = (taskId: string, itemIds: string[], station: Station, ts: string) => {
    for (const itemId of itemIds) {
      const r = db
        .prepare("UPDATE items SET task_id = ?, station = ?, updated_at = ? WHERE id = ?")
        .run(taskId, station, ts, itemId);
      if (!r.changes) throw new NotFoundError("item", itemId);
    }
  };

  return {
    get,

    list(f: { station?: Station; source?: Source } = {}): Task[] {
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
      const rows = db
        .prepare(`SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY station, position, created_at`)
        .all(...args);
      return fromRows<Task>(rows, SPEC).map((t) => ({ ...t, items: linked(t.id) }));
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
     */
    move(id: string, station: Station, position?: number, now = new Date()): Task {
      const ts = nowIso(now);
      tx(db, () => {
        get(id);
        db.prepare(
          "UPDATE tasks SET station = ?, position = COALESCE(?, position), sync_state = 'pending', sync_error = NULL, updated_at = ? WHERE id = ?",
        ).run(station, position ?? null, ts, id);
        db.prepare("UPDATE items SET station = ?, updated_at = ? WHERE task_id = ?").run(station, ts, id);
        touchInteraction(db, now);
      });
      return get(id);
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

    pendingSync(): Task[] {
      return fromRows<Task>(db.prepare("SELECT * FROM tasks WHERE sync_state = 'pending' ORDER BY updated_at").all(), SPEC);
    },

    remove(id: string): void {
      const r = db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
      if (!r.changes) throw new NotFoundError("task", id);
    },
  };
}
