// Source health, reported by sessions (Slack, Basecamp: they reach them through MCP)
// and by the server (GitHub). When a source comes back, salidas queued for it
// ("Aprobar al volver") are released again and the owner re-checks the thread.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRows, nowIso } from "../db/util";
import type { HealthSource, SourceHealthRow } from "../domain/types";
import { salidasRepo } from "./salidas";

export function healthRepo(db: Db) {
  return {
    list(): SourceHealthRow[] {
      return fromRows<SourceHealthRow>(db.prepare("SELECT * FROM source_health ORDER BY source").all());
    },

    isDown(source: HealthSource): boolean {
      return Boolean(db.prepare("SELECT 1 FROM source_health WHERE source = ? AND state = 'down'").get(source));
    },

    /** Returns the ids of salidas resumed because the source came back. */
    set(source: HealthSource, state: SourceHealthRow["state"], note = "", now = new Date()): { row: SourceHealthRow; resumed: string[] } {
      return tx(db, () => {
        const wasDown = this.isDown(source);
        db.prepare(
          `INSERT INTO source_health (source, state, note, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(source) DO UPDATE SET state = excluded.state, note = excluded.note, updated_at = excluded.updated_at`,
        ).run(source, state, note, nowIso(now));
        const resumed: string[] = [];
        if (wasDown && state !== "down") {
          const s = salidasRepo(db);
          for (const q of s.list({ status: ["queued_until_back"] }).filter((x) => x.source === source)) {
            s.transition(q.id, { type: "resume" }, now);
            resumed.push(q.id);
          }
        }
        return { row: this.list().find((r) => r.source === source)!, resumed };
      });
    },
  };
}
