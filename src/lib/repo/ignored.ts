// Ignored projects ("Ignorar proyecto"). Ingest skips them; Hoy, the band counts and Tablero
// filter their items and tasks out by query (ITEM_IGNORED / TASK_IGNORED), so nothing is
// flagged or deleted and removing the row brings everything back. Salidas are never filtered.
import type { Db } from "../db/sqlite";
import { fromRow, fromRows, newId, NotFoundError, nowIso } from "../db/util";
import { matchesIgnored, projectKey, type IgnoredProject, type IgnoreSource } from "../domain/ignore";
import type { Source } from "../domain/types";
import { touchInteraction } from "./interaction";

/** SQL condition: the item aliased `a` belongs to an ignored project. */
export const ITEM_IGNORED = (a: string) =>
  `EXISTS (SELECT 1 FROM ignored_projects ip WHERE ip.source IN (${a}.source, '*') AND ip.project IN (${a}.project_key, ${a}.project))`;

/**
 * SQL condition: the task aliased `a` belongs to an ignored project, by its own project or by
 * a linked item of its lane's source (a GitHub task made from Hoy carries the bare repo name,
 * its linked PR item carries owner/repo).
 */
export const TASK_IGNORED = (a: string) =>
  `(EXISTS (SELECT 1 FROM ignored_projects ip WHERE ip.source IN (${a}.source, '*') AND ip.project = ${a}.project)` +
  ` OR EXISTS (SELECT 1 FROM items li WHERE li.task_id = ${a}.id AND li.source = ${a}.source AND ${ITEM_IGNORED("li")}))`;

/** SQL expression: the project key of the task aliased `a` (its lane's linked item key, else its project). */
export const TASK_KEY = (a: string) =>
  `COALESCE((SELECT li.project_key FROM items li WHERE li.task_id = ${a}.id AND li.source = ${a}.source AND li.project_key <> '' ORDER BY li.received_at LIMIT 1), ${a}.project)`;

export interface IgnoreInput {
  source: IgnoreSource;
  project: string;
  label?: string;
}

export function ignoredRepo(db: Db) {
  const get = (id: string): IgnoredProject => {
    const row = db.prepare("SELECT * FROM ignored_projects WHERE id = ?").get(id);
    if (!row) throw new NotFoundError("ignored project", id);
    return fromRow<IgnoredProject>(row);
  };

  const list = (): IgnoredProject[] => fromRows<IgnoredProject>(db.prepare("SELECT * FROM ignored_projects ORDER BY created_at, id").all());

  return {
    get,
    list,

    /** Ignore a project. Idempotent by (source, project): adding it again returns the existing row. */
    add(input: IgnoreInput, now = new Date()): { ignored: IgnoredProject; created: boolean } {
      const project = input.project.trim();
      const existing = db.prepare("SELECT id FROM ignored_projects WHERE source = ? AND project = ?").get(input.source, project) as { id: string } | undefined;
      touchInteraction(db, now);
      if (existing) return { ignored: get(existing.id), created: false };
      const id = newId("ig");
      db.prepare("INSERT INTO ignored_projects (id, source, project, label, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id,
        input.source,
        project,
        (input.label ?? "").trim() || project,
        nowIso(now),
      );
      return { ignored: get(id), created: true };
    },

    /** Stop ignoring. Returns the removed row. */
    remove(id: string, now = new Date()): IgnoredProject {
      const row = get(id);
      db.prepare("DELETE FROM ignored_projects WHERE id = ?").run(id);
      touchInteraction(db, now);
      return row;
    },

    /** Would an item with this source / dedupe key / project be ignored? (ingest, upsert API) */
    isItemIgnored(i: { source: Source; externalId: string; project?: string | null }, rows: readonly IgnoredProject[] = list()): boolean {
      if (!rows.length) return false;
      return matchesIgnored(rows, { source: i.source, key: projectKey(i), project: i.project });
    },

    /** Open items (not Hecho) and open tasks each ignored row hides right now. */
    hiddenCounts(): Record<string, { items: number; tasks: number }> {
      const out: Record<string, { items: number; tasks: number }> = {};
      for (const r of list()) {
        const items = (
          db
            .prepare("SELECT COUNT(*) AS n FROM items i WHERE i.station <> 'done' AND (? IN (i.source, '*')) AND ? IN (i.project_key, i.project)")
            .get(r.source, r.project) as { n: number }
        ).n;
        const tasks = (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM tasks t WHERE t.station <> 'done' AND (? IN (t.source, '*')) AND (t.project = ? OR ? IN (SELECT li.project_key FROM items li WHERE li.task_id = t.id AND li.source = t.source))`,
            )
            .get(r.source, r.project, r.project) as { n: number }
        ).n;
        out[r.id] = { items, tasks };
      }
      return out;
    },
  };
}
