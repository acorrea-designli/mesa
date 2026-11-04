// Per-source sweep state and health. The mesa-sweep skill (a haiku sweeper on a ~60 s
// two-stage tick) reads and writes the watermark, last probe, last new item, backoff and
// cadence here; sessions and the server report health. When a source comes back from
// "down", salidas queued for it ("Aprobar al volver") are released with a thread re-check.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRow, fromRows, nowIso, toAssignments } from "../db/util";
import type { HealthSource, SourceState } from "../domain/types";
import { salidasRepo } from "./salidas";

export type SourcePatch = Partial<Omit<SourceState, "source" | "updatedAt">>;

export function sourcesRepo(db: Db) {
  const find = (source: HealthSource): SourceState | null => {
    const row = db.prepare("SELECT * FROM source_state WHERE source = ?").get(source);
    return row ? fromRow<SourceState>(row) : null;
  };

  return {
    list(): SourceState[] {
      return fromRows<SourceState>(db.prepare("SELECT * FROM source_state ORDER BY source").all());
    },

    /** The row, or the defaults for a source never reported. */
    get(source: HealthSource): SourceState {
      return (
        find(source) ?? {
          source,
          health: "ok",
          note: "",
          watermark: null,
          lastChecked: null,
          lastNewAt: null,
          backoffUntil: null,
          cadenceS: 60,
          errorCount: 0,
          lastError: null,
          updatedAt: new Date(0).toISOString(),
        }
      );
    },

    isDown(source: HealthSource): boolean {
      return find(source)?.health === "down";
    },

    /** Merge the fields given. Returns the row and the salidas resumed if the source came back. */
    set(source: HealthSource, patch: SourcePatch, now = new Date()): { source: SourceState; resumed: string[] } {
      return tx(db, () => {
        const wasDown = this.isDown(source);
        db.prepare("INSERT OR IGNORE INTO source_state (source, updated_at) VALUES (?, ?)").run(source, nowIso(now));
        const { sql, values } = toAssignments({ ...patch, updatedAt: nowIso(now) });
        db.prepare(`UPDATE source_state SET ${sql} WHERE source = ?`).run(...values, source);
        const row = find(source)!;
        const resumed: string[] = [];
        if (wasDown && row.health !== "down") {
          const s = salidasRepo(db);
          for (const q of s.list({ status: ["queued_until_back"] }).filter((x) => x.source === source)) {
            s.transition(q.id, { type: "resume" }, now);
            resumed.push(q.id);
          }
        }
        return { source: row, resumed };
      });
    },
  };
}
