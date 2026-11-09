// /semana: what was done in a [start, end) window. Plain reads over tickets, salidas, reviews and tasks;
// the grouping and dedupe live in domain/week.ts.
import type { Db } from "../db/sqlite";
import { fromRows } from "../db/util";
import { SIMULATED_SCHEME } from "../domain/sandbox";
import type { DoneRows } from "../domain/week";
import { TASK_IGNORED } from "./ignored";

export interface DoneQuery {
  /** Window start, inclusive (ISO). */
  start: string;
  /** Window end, exclusive (ISO). */
  end: string;
  /** Sample rows ("Datos de muestra.") are left out unless asked for. */
  includeSamples?: boolean;
}

export function weekRepo(db: Db) {
  return {
    done(q: DoneQuery): DoneRows {
      const sample = (a: string) => (q.includeSamples ? "" : ` AND ${a}.is_sample = 0`);
      const win = [q.start, q.end];
      const bool = { bool: ["is_sample"] };

      const tickets = fromRows<DoneRows["tickets"][number]>(
        db
          .prepare(`SELECT id, ref, title, project, closed_at, is_sample FROM tickets t WHERE t.status = 'closed' AND t.closed_at >= ? AND t.closed_at < ?${sample("t")}`)
          .all(...win),
        bool,
      );

      // A simulated send (sandbox) never left Mesa; it is not work that was done.
      const salidas = fromRows<DoneRows["salidas"][number]>(
        db
          .prepare(
            `SELECT s.id, s.title, s.destination, s.permalink, s.sent_at, s.is_sample,
                    t.ref AS ticket_ref, t.project AS ticket_project,
                    (SELECT r.id FROM reviews r WHERE r.salida_id = s.id AND r.state = 'approved') AS review_id
               FROM salidas s LEFT JOIN tickets t ON t.id = s.ticket_id
              WHERE s.status = 'sent' AND s.sent_at >= ? AND s.sent_at < ?
                AND COALESCE(s.permalink, '') NOT LIKE '${SIMULATED_SCHEME}%'${sample("s")}`,
          )
          .all(...win),
        { json: ["destination"], bool: ["is_sample"] },
      );

      // A review has no approved_at: the approval write's sent_at is the moment, else the row's last update.
      const reviews = fromRows<DoneRows["reviews"][number]>(
        db
          .prepare(
            `SELECT r.id, r.repo, r.pr, r.is_sample, COALESCE(s.sent_at, r.updated_at) AS at,
                    t.ref AS ticket_ref, t.project AS ticket_project
               FROM reviews r
               LEFT JOIN salidas s ON s.id = r.salida_id AND s.status = 'sent'
               LEFT JOIN tickets t ON t.id = r.ticket_id
              WHERE r.state = 'approved' AND COALESCE(s.sent_at, r.updated_at) >= ? AND COALESCE(s.sent_at, r.updated_at) < ?${sample("r")}`,
          )
          .all(...win),
        bool,
      );

      // A task has no done_at: updated_at while in station done. Ignored projects stay off, like on Tablero.
      const tasks = fromRows<DoneRows["tasks"][number]>(
        db
          .prepare(
            `SELECT a.id, a.title, a.project, a.updated_at AS at, a.ticket_id, a.is_sample,
                    COALESCE((SELECT li.url FROM items li WHERE li.task_id = a.id AND li.url IS NOT NULL ORDER BY li.received_at LIMIT 1), a.gh_content_url) AS url,
                    t.ref AS ticket_ref, t.project AS ticket_project
               FROM tasks a LEFT JOIN tickets t ON t.id = a.ticket_id
              WHERE a.station = 'done' AND a.updated_at >= ? AND a.updated_at < ?
                AND NOT ${TASK_IGNORED("a")}${sample("a")}`,
          )
          .all(...win),
        bool,
      );

      return { tickets, salidas, reviews, tasks };
    },
  };
}
