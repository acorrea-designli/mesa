import type { Db } from "../db/sqlite";
import { fromRow, fromRows, insertSql, newId, NotFoundError, nowIso, toAssignments } from "../db/util";
import type { Item, Source, Station } from "../domain/types";
import { ITEM_IGNORED } from "./ignored";

const SPEC = { json: ["meta"], bool: ["is_sample"] };

export interface ItemInput {
  source: Source;
  externalId: string;
  kind: string;
  title: string;
  excerpt?: string;
  project?: string;
  url?: string | null;
  need?: string;
  station?: Station;
  waitOn?: string;
  tag?: string | null;
  taskId?: string | null;
  meta?: Record<string, unknown>;
  isSample?: boolean;
  receivedAt?: string;
}

export type ItemPatch = Partial<Omit<ItemInput, "source" | "externalId">>;

export interface ItemFilter {
  station?: Station;
  source?: Source;
  includeSamples?: boolean;
  /** Items of ignored projects: "include" (default), "exclude" (Hoy, band, ingest) or "only". */
  ignored?: "include" | "exclude" | "only";
  /** "you": open (station not done) and waiting on Andrés, the items Hoy shows as his. */
  open?: "you";
}

export function itemsRepo(db: Db) {
  const get = (id: string): Item => {
    const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id);
    if (!row) throw new NotFoundError("item", id);
    return fromRow<Item>(row, SPEC);
  };

  return {
    get,

    list(f: ItemFilter = {}): Item[] {
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
      if (f.open === "you") where.push("station <> 'done' AND wait_on = 'you'");
      if (f.includeSamples === false) where.push("is_sample = 0");
      if (f.ignored === "exclude") where.push(`NOT ${ITEM_IGNORED("items")}`);
      if (f.ignored === "only") where.push(ITEM_IGNORED("items"));
      const sql = `SELECT * FROM items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY received_at`;
      return fromRows<Item>(db.prepare(sql).all(...args), SPEC);
    },

    create(input: ItemInput, now = new Date()): Item {
      const id = newId("it");
      const ts = nowIso(now);
      const { sql, values } = insertSql(
        "items",
        { id, ...input, receivedAt: input.receivedAt ?? ts, createdAt: ts, updatedAt: ts },
        SPEC,
      );
      db.prepare(sql).run(...values);
      return get(id);
    },

    /**
     * Insert or update by (source, externalId). Station is kept on update unless given. A skipped item
     * ("Saltar") keeps its station and waitOn whatever the input says: only its content refreshes.
     */
    upsert(input: ItemInput, now = new Date()): { item: Item; created: boolean } {
      const existing = db
        .prepare("SELECT id, skipped_at FROM items WHERE source = ? AND external_id = ?")
        .get(input.source, input.externalId) as { id: string; skipped_at: string | null } | undefined;
      if (!existing) return { item: this.create(input, now), created: true };
      const { source: _s, externalId: _e, ...patch } = input;
      void _s;
      void _e;
      if (existing.skipped_at) {
        delete patch.station;
        delete patch.waitOn;
      }
      return { item: this.update(existing.id, patch, now), created: false };
    },

    /** A move to a station other than done brings a skipped item back for real: skippedAt is cleared. */
    update(id: string, patch: ItemPatch, now = new Date()): Item {
      get(id);
      const clear = patch.station !== undefined && patch.station !== "done" ? { skippedAt: null } : {};
      const { sql, values } = toAssignments({ ...patch, ...clear, updatedAt: nowIso(now) }, SPEC);
      db.prepare(`UPDATE items SET ${sql} WHERE id = ?`).run(...values, id);
      return get(id);
    },

    /** "Saltar": done, waitOn none, skippedAt now. Never touches the card (task_id) or a ticket. */
    skip(id: string, now = new Date()): Item {
      get(id);
      const ts = nowIso(now);
      db.prepare("UPDATE items SET station = 'done', wait_on = 'none', skipped_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, id);
      return get(id);
    },

    /** Deshacer of skip: restores the station and waitOn the item had, and clears skippedAt. */
    unskip(id: string, restore: { station: Station; waitOn: string }, now = new Date()): Item {
      get(id);
      db.prepare("UPDATE items SET station = ?, wait_on = ?, skipped_at = NULL, updated_at = ? WHERE id = ?").run(
        restore.station,
        restore.waitOn,
        nowIso(now),
        id,
      );
      return get(id);
    },

    remove(id: string): void {
      const r = db.prepare("DELETE FROM items WHERE id = ?").run(id);
      if (!r.changes) throw new NotFoundError("item", id);
    },
  };
}
