import type { Db } from "../db/sqlite";
import { fromRow, fromRows, newId, nowIso } from "../db/util";
import type { EngramLink } from "../domain/types";

export interface EngramLinkInput {
  entityType: EngramLink["entityType"];
  entityId: string;
  project: string;
  topicKey?: string;
  observationId?: string;
}

/** Mesa never writes engram itself; sessions save there and record the pointer here. */
export function engramRepo(db: Db) {
  return {
    link(i: EngramLinkInput, now = new Date()): EngramLink {
      const id = newId("en");
      db.prepare(
        `INSERT INTO engram_links (id, entity_type, entity_id, project, topic_key, observation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, i.entityType, i.entityId, i.project, i.topicKey ?? null, i.observationId ?? null, nowIso(now));
      return fromRow<EngramLink>(db.prepare("SELECT * FROM engram_links WHERE id = ?").get(id));
    },

    list(entityType: EngramLink["entityType"], entityId: string): EngramLink[] {
      return fromRows<EngramLink>(
        db.prepare("SELECT * FROM engram_links WHERE entity_type = ? AND entity_id = ? ORDER BY created_at").all(entityType, entityId),
      );
    },
  };
}
