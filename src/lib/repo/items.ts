import type { Db } from "../db/sqlite";
import { fromRow, fromRows, insertSql, newId, NotFoundError, nowIso, toAssignments } from "../db/util";
import type { Item, Source, Station } from "../domain/types";

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
      if (f.includeSamples === false) where.push("is_sample = 0");
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

    /** Insert or update by (source, externalId). Station is kept on update unless given. */
    upsert(input: ItemInput, now = new Date()): { item: Item; created: boolean } {
      const existing = db
        .prepare("SELECT id FROM items WHERE source = ? AND external_id = ?")
        .get(input.source, input.externalId) as { id: string } | undefined;
      if (!existing) return { item: this.create(input, now), created: true };
      const { source: _s, externalId: _e, ...patch } = input;
      void _s;
      void _e;
      return { item: this.update(existing.id, patch, now), created: false };
    },

    update(id: string, patch: ItemPatch, now = new Date()): Item {
      get(id);
      const { sql, values } = toAssignments({ ...patch, updatedAt: nowIso(now) }, SPEC);
      db.prepare(`UPDATE items SET ${sql} WHERE id = ?`).run(...values, id);
      return get(id);
    },

    remove(id: string): void {
      const r = db.prepare("DELETE FROM items WHERE id = ?").run(id);
      if (!r.changes) throw new NotFoundError("item", id);
    },
  };
}
