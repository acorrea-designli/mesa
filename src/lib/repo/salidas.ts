import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import {
  fromRow,
  fromRows,
  insertSql,
  newId,
  NotFoundError,
  nowIso,
  toAssignments,
  TransitionError,
  ValidationError,
} from "../db/util";
import { eventBodyProblem, parseEventBody } from "../domain/calendar-event";
import { isMoveBody, moveBodyProblem } from "../domain/calendar-move";
import { HISTORY_MAX, HISTORY_PAGE, NOT_LISTED, QUEUE_STAY, type HistoryCursor, type SalidaHistoryRow } from "../domain/salida-queue";
import {
  canAddVersion,
  dueEvent,
  transitionSalida,
  type SalidaEvent,
} from "../domain/salida-machine";
import type {
  Destination,
  EngramLink,
  Mark,
  Salida,
  SalidaDetail,
  SalidaLink,
  SalidaSource,
  SalidaStatus,
  SalidaUpload,
  SalidaTurn,
  SalidaVersion,
} from "../domain/types";
import { emitWake } from "../wake/wake";
import { chipsRepo } from "./chips";
import { touchInteraction } from "./interaction";
import { ticketsRepo } from "./tickets";
import { settlePrQuestions } from "./intake";
import { ensureSession } from "./sessions";

/** Events only Andrés triggers from the UI; they count as interaction for the sweeper. */
const ANDRES_EVENTS = new Set<SalidaEvent["type"]>([
  "approve",
  "undo",
  "deny",
  "schedule",
  "unschedule",
  "unqueue",
  "retry",
  "request_delete",
  "request_restore",
  "confirm_sent", // "Ya lo envié"
]);

/** Andrés's presses that take his turn on the salida's ticket (an undo gives it back through the salida's own need). */
const TURN_TAKING_EVENTS = new Set<SalidaEvent["type"]>(["approve", "schedule", "deny", "confirm_sent", "unqueue"]);

/** Events only the sending session reports; refused for sample salidas. */
const SEND_EVENTS = new Set<SalidaEvent["type"]>(["sent", "drafted", "failed", "hold", "bounce", "deleted", "restored"]);

const S_SPEC = { json: ["destination", "links"], bool: ["is_sample"] };
const V_SPEC = { bool: ["starred"] };
const TURN_SPEC = { json: ["marks"] };

export interface SalidaInput {
  source: SalidaSource;
  destination: Destination;
  body: string; // v1
  title?: string;
  context?: string;
  ticketId?: string;
  links?: SalidaLink[];
  ownerSession?: string;
  expiresAt?: string;
  isSample?: boolean;
  /** Create as draft (not yet visible for approval). Default: pending. */
  draft?: boolean;
}

export interface VersionInput {
  body: string;
  author: "claude" | "andres";
  /** The Andrés turn this version answers. */
  turnId?: string;
  /** Short label Claude gives the request ("Más corto"); feeds the learned chips. */
  chipLabel?: string;
}

export interface TurnInput {
  body?: string;
  marks?: Mark[];
  /** Set when Andrés clicked a learned chip instead of typing. */
  chipLabel?: string;
}

export function salidasRepo(db: Db) {
  const tickets = ticketsRepo(db);
  const get = (id: string): Salida => {
    const row = db.prepare("SELECT * FROM salidas WHERE id = ?").get(id);
    if (!row) throw new NotFoundError("salida", id);
    return fromRow<Salida>(row, S_SPEC);
  };

  const versionCount = (id: string) =>
    (db.prepare("SELECT COUNT(*) AS n FROM salida_versions WHERE salida_id = ?").get(id) as { n: number }).n;

  const rewritePending = (id: string) =>
    Boolean(
      db.prepare("SELECT 1 FROM salida_turns WHERE salida_id = ? AND author = 'andres' AND state = 'open' LIMIT 1").get(id),
    );

  // The calendar's health is about READING the feed; creating an event goes through the connector, so a feed outage
  // never parks a calendar salida in "Aprobar al volver".
  const sourceDown = (source: string) =>
    source !== "calendar" &&
    Boolean(db.prepare("SELECT 1 FROM source_state WHERE source = ? AND health = 'down'").get(source));

  // A calendar salida's body IS the event (src/lib/domain/calendar-event.ts) or a move of one (calendar-move.ts): every version must be a complete, valid one.
  const checkBody = (source: string, body: string) => {
    const problem = source === "calendar" ? (isMoveBody(body) ? moveBodyProblem(body) : eventBodyProblem(body)) : null;
    if (problem) throw new ValidationError(`calendar salida body: ${problem}`);
  };

  // The destination of a calendar salida lists the invitees and the Meet for the chips and the queue line, but the
  // version's body is the truth (it is what Aprobar signs and what hook G5 compares). Every time the current version
  // changes (a new version, "Volver a vN") the destination is rewritten from that body, so it can never go stale.
  const syncCalendarDestination = (salidaId: string, body: string) => {
    const s = get(salidaId);
    if (s.source !== "calendar" || s.destination.kind !== "calendar_event") return;
    const p = parseEventBody(body);
    if (!p.ok) return;
    const d = { ...s.destination, invitees: p.fields.invitees, meet: p.fields.meet };
    if (p.fields.recurrence) d.recurrence = p.fields.recurrence;
    else delete d.recurrence; // the body dropped `Repetir`
    db.prepare("UPDATE salidas SET destination = ? WHERE id = ?").run(JSON.stringify(d), salidaId);
  };

  const insertVersion = (salidaId: string, v: VersionInput, ts: string): number => {
    const n = versionCount(salidaId) + 1;
    const { sql, values } = insertSql(
      "salida_versions",
      { id: newId("sv"), salidaId, n, body: v.body, author: v.author, turnId: v.turnId ?? null, starred: false, createdAt: ts },
      V_SPEC,
    );
    db.prepare(sql).run(...values);
    db.prepare("UPDATE salidas SET current_version = ?, updated_at = ? WHERE id = ?").run(n, ts, salidaId);
    syncCalendarDestination(salidaId, v.body);
    return n;
  };

  const patch = (id: string, p: Partial<Salida>, ts: string) => {
    const { sql, values } = toAssignments({ ...p, updatedAt: ts }, S_SPEC);
    db.prepare(`UPDATE salidas SET ${sql} WHERE id = ?`).run(...values, id);
  };

  const repo = {
    get,

    detail(id: string): SalidaDetail {
      const s = get(id);
      return {
        ...s,
        versions: fromRows<SalidaVersion>(
          db.prepare("SELECT * FROM salida_versions WHERE salida_id = ? ORDER BY n").all(id),
          V_SPEC,
        ),
        turns: fromRows<SalidaTurn>(
          db.prepare("SELECT * FROM salida_turns WHERE salida_id = ? ORDER BY created_at, rowid").all(id),
          TURN_SPEC,
        ),
        engram: fromRows<EngramLink>(
          db.prepare("SELECT * FROM engram_links WHERE entity_type = 'salida' AND entity_id = ? ORDER BY created_at").all(id),
        ),
        uploads: fromRows<SalidaUpload>(
          db.prepare("SELECT * FROM salida_uploads WHERE salida_id = ? ORDER BY file_index").all(id),
        ),
      };
    },

    /**
     * t196: the lead records the sgid create_attachment returned for file `fileIndex` of a Basecamp salida. The sha256 is
     * the one measured when the salida was proposed (never taken from the caller), so a row always names the approved bytes.
     * A retried upload replaces its row. Only a salida that is still open for a send takes it.
     */
    recordUpload(id: string, fileIndex: number, sgid: string, now = new Date()): SalidaDetail {
      const s = get(id);
      const files = "files" in s.destination ? (s.destination.files ?? []) : [];
      const f = files[fileIndex];
      if (!f) throw new ValidationError(`salida ${id} has no file ${fileIndex} (it has ${files.length})`);
      if (!/^[A-Za-z0-9_=+/.-]{16,}$/.test(sgid)) throw new ValidationError("sgid does not look like a Basecamp attachable_sgid");
      if (s.status !== "sending" || !s.releasedAt) throw new TransitionError(`salida ${id} is ${s.status}: record an upload only after salida.released`);
      db.prepare(
        "INSERT INTO salida_uploads (salida_id, file_index, sha256, sgid, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(salida_id, file_index) DO UPDATE SET sha256 = excluded.sha256, sgid = excluded.sgid, created_at = excluded.created_at",
      ).run(id, fileIndex, f.sha256, sgid, nowIso(now));
      return repo.detail(id);
    },

    list(f: { status?: SalidaStatus[] } = {}): Salida[] {
      const st = f.status ?? [];
      const where = st.length ? `WHERE status IN (${st.map(() => "?").join(", ")})` : "";
      return fromRows<Salida>(db.prepare(`SELECT * FROM salidas ${where} ORDER BY created_at`).all(...st), S_SPEC);
    },

    /** t204: the queue strip, newest first: `inQueue` (src/lib/domain/salida-queue.ts) as SQL. `day` is `dayStart(now)`. */
    queue(day: string): Salida[] {
      const stay = QUEUE_STAY.map(() => "?").join(", ");
      const hidden = NOT_LISTED.map(() => "?").join(", ");
      return fromRows<Salida>(
        db
          .prepare(
            `SELECT * FROM salidas WHERE status NOT IN (${hidden}) AND (status IN (${stay}) OR created_at >= ? OR updated_at >= ?) ORDER BY created_at DESC, rowid DESC`,
          )
          .all(...NOT_LISTED, ...QUEUE_STAY, day, day),
        S_SPEC,
      );
    },

    /**
     * t204: one page of the Historial: every salida the strip does not show (the complement of `queue(day)`), by last
     * update, newest first. Reads only what a row shows (no versions, no ticket history). `next` is the cursor of the
     * following page, null on the last one.
     */
    history(f: { day: string; limit?: number; cursor?: HistoryCursor | null }): { rows: SalidaHistoryRow[]; next: HistoryCursor | null } {
      const limit = Math.min(Math.max(Math.trunc(f.limit ?? HISTORY_PAGE) || HISTORY_PAGE, 1), HISTORY_MAX);
      const stay = QUEUE_STAY.map(() => "?").join(", ");
      const hidden = NOT_LISTED.map(() => "?").join(", ");
      const args: (string | number)[] = [...NOT_LISTED, ...QUEUE_STAY, f.day, f.day];
      let after = "";
      if (f.cursor) {
        after = "AND (s.updated_at < ? OR (s.updated_at = ? AND s.id < ?))";
        args.push(f.cursor.updatedAt, f.cursor.updatedAt, f.cursor.id);
      }
      const raw = db
        .prepare(
          `SELECT s.id, s.source, s.status, s.destination, s.permalink, s.sent_at, s.expires_at, s.send_at, s.created_at, s.updated_at, s.is_sample,
                  (SELECT substr(v.body, 1, 400) FROM salida_versions v WHERE v.salida_id = s.id AND v.n = s.current_version) AS body,
                  (SELECT t.ref FROM tickets t WHERE t.id = s.ticket_id) AS ticket_ref
             FROM salidas s
            WHERE s.status NOT IN (${hidden}) AND s.status NOT IN (${stay}) AND s.created_at < ? AND s.updated_at < ? ${after}
            ORDER BY s.updated_at DESC, s.id DESC
            LIMIT ${limit + 1}`,
        )
        .all(...args);
      const all = fromRows<SalidaHistoryRow>(raw, S_SPEC).map((r) => ({ ...r, body: r.body ?? "", ticketRef: r.ticketRef ?? null }));
      const rows = all.slice(0, limit);
      const last = rows[rows.length - 1];
      return { rows, next: all.length > limit && last ? { updatedAt: last.updatedAt, id: last.id } : null };
    },

    /** Claude proposes a message: creates the salida with v1. */
    create(input: SalidaInput, now = new Date()): SalidaDetail {
      const id = newId("sa");
      const ts = nowIso(now);
      checkBody(input.source, input.body);
      return tx(db, () => {
        ensureSession(db, input.ownerSession, now);
        const { sql, values } = insertSql(
          "salidas",
          {
            id,
            status: input.draft ? "draft" : "pending",
            source: input.source,
            destination: input.destination,
            title: input.title ?? "",
            context: input.context ?? "",
            ticketId: input.ticketId ?? null,
            links: input.links ?? [],
            ownerSession: input.ownerSession ?? null,
            currentVersion: 0,
            expiresAt: input.expiresAt ?? null,
            isSample: input.isSample ?? false,
            createdAt: ts,
            updatedAt: ts,
          },
          S_SPEC,
        );
        db.prepare(sql).run(...values);
        insertVersion(id, { body: input.body, author: "claude" }, ts);
        return repo.detail(id);
      });
    },

    /** A new immutable version. It becomes current, so Aprobar sends it. */
    addVersion(id: string, v: VersionInput, now = new Date()): SalidaDetail {
      return tx(db, () => {
        const s = get(id);
        if (!canAddVersion(s.status)) throw new TransitionError(`cannot add a version to a salida that is ${s.status}`);
        checkBody(s.source, v.body);
        const ts = nowIso(now);
        let turnId = v.turnId;
        if (!turnId && v.author === "claude") {
          // Answer the oldest open turn by default.
          const open = db
            .prepare("SELECT id FROM salida_turns WHERE salida_id = ? AND author = 'andres' AND state = 'open' ORDER BY created_at, rowid LIMIT 1")
            .get(id) as { id: string } | undefined;
          turnId = open?.id;
        }
        const n = insertVersion(id, { ...v, turnId }, ts);
        if (turnId) {
          const turn = db.prepare("SELECT * FROM salida_turns WHERE id = ? AND salida_id = ?").get(turnId, id);
          if (!turn) throw new NotFoundError("turn", turnId);
          const t = fromRow<SalidaTurn>(turn, TURN_SPEC);
          const label = v.chipLabel ?? t.chipLabel;
          db.prepare("UPDATE salida_turns SET state = 'answered', chip_label = ? WHERE id = ?").run(label ?? null, turnId);
          // Claude's side of the chat: a short turn pointing at the new version.
          const { sql, values } = insertSql(
            "salida_turns",
            { id: newId("st"), salidaId: id, author: "claude", body: `v${n}`, marks: [], onVersion: n, state: "answered", createdAt: ts },
            TURN_SPEC,
          );
          db.prepare(sql).run(...values);
          if (label && t.body) chipsRepo(db).learn(label, t.body, now);
        }
        return repo.detail(id);
      });
    },

    /** Show a different version ("Volver a v4"): it becomes the one Aprobar sends. */
    selectVersion(id: string, n: number, now = new Date()): SalidaDetail {
      const s = get(id);
      if (!canAddVersion(s.status)) throw new TransitionError(`cannot change the version of a salida that is ${s.status}`);
      if (n < 1 || n > versionCount(id)) throw new TransitionError(`version ${n} does not exist`);
      patch(id, { currentVersion: n }, nowIso(now));
      const picked = db.prepare("SELECT body FROM salida_versions WHERE salida_id = ? AND n = ?").get(id, n) as { body: string } | undefined;
      if (picked) syncCalendarDestination(id, picked.body);
      touchInteraction(db, now);
      return repo.detail(id);
    },

    star(id: string, n: number, starred: boolean): SalidaDetail {
      touchInteraction(db);
      const r = db.prepare("UPDATE salida_versions SET starred = ? WHERE salida_id = ? AND n = ?").run(starred ? 1 : 0, id, n);
      if (!r.changes) throw new NotFoundError("version", `${id}/v${n}`);
      return repo.detail(id);
    },

    /** Andrés asks Claude for a change (text, semáforo marks, or a learned chip). Wakes the owner. */
    addTurn(id: string, t: TurnInput, now = new Date()): SalidaDetail {
      return tx(db, () => {
        const s = get(id);
        if (!canAddVersion(s.status)) throw new TransitionError(`cannot refine a salida that is ${s.status}`);
        const body = (t.body ?? t.chipLabel ?? "").trim();
        const marks = t.marks ?? [];
        if (!body && !marks.length) throw new TransitionError("a refine turn needs text or marks");
        const turnId = newId("st");
        const { sql, values } = insertSql(
          "salida_turns",
          { id: turnId, salidaId: id, author: "andres", body, marks, onVersion: s.currentVersion, state: "open", chipLabel: t.chipLabel ?? null, createdAt: nowIso(now) },
          TURN_SPEC,
        );
        db.prepare(sql).run(...values);
        if (t.chipLabel) chipsRepo(db).learn(t.chipLabel, null, now);
        touchInteraction(db, now);
        emitWake(db, { sessionId: s.ownerSession, kind: "salida.turn", entityType: "salida", entityId: id, payload: { turnId } }, now);
        return repo.detail(id);
      });
    },

    /** "Cancelar el cambio": drop the open turn so Aprobar works again. */
    cancelTurn(id: string, turnId: string): SalidaDetail {
      const r = db
        .prepare("UPDATE salida_turns SET state = 'cancelled' WHERE id = ? AND salida_id = ? AND state = 'open'")
        .run(turnId, id);
      if (!r.changes) throw new NotFoundError("open turn", turnId);
      return repo.detail(id);
    },

    /** Andrés edits the text by hand ("tu versión"). Cancels any open turn. */
    edit(id: string, body: string, now = new Date()): SalidaDetail {
      return tx(db, () => {
        db.prepare("UPDATE salida_turns SET state = 'cancelled' WHERE salida_id = ? AND state = 'open'").run(id);
        touchInteraction(db, now);
        return repo.addVersion(id, { body, author: "andres" }, now);
      });
    },

    /**
     * Apply a state machine event and emit its wake. Sample salidas ("Datos de muestra.")
     * can never be sent: the send-side events are refused unless the seed itself is
     * building the sample states (`opts.seed`).
     */
    transition(id: string, ev: SalidaEvent, now = new Date(), opts: { seed?: boolean } = {}): SalidaDetail {
      return tx(db, () => {
        const s = get(id);
        if (s.isSample && !opts.seed && SEND_EVENTS.has(ev.type)) {
          throw new TransitionError(`salida ${id} is sample data (Datos de muestra.) and can never be sent: do not send it, ignore it`);
        }
        const r = transitionSalida(s, ev, now, {
          versionCount: versionCount(id),
          rewritePending: rewritePending(id),
          sourceDown: sourceDown(s.source),
        });
        if (!r.ok) throw new TransitionError(r.error);
        patch(id, r.patch, nowIso(now));
        // A withdrawn review write frees its findings: they point at no salida, so "Post" can send them again.
        if (ev.type === "withdraw") db.prepare("UPDATE review_findings SET salida_id = NULL, updated_at = ? WHERE salida_id = ?").run(nowIso(now), id);
        if (ANDRES_EVENTS.has(ev.type)) touchInteraction(db, now);
        // The seed builds sample states and is not a press.
        if (TURN_TAKING_EVENTS.has(ev.type) && !opts.seed) tickets.andresActed(s.ticketId, now);
        // A Slack question about a PR (repo/intake.ts) leaves Hoy once its reply is sent or denied.
        if (r.patch.status && r.patch.status !== s.status) settlePrQuestions(db, { ...s, status: r.patch.status }, now);
        if (r.wake) {
          const next = get(id);
          emitWake(
            db,
            {
              sessionId: s.ownerSession,
              kind: r.wake,
              entityType: "salida",
              entityId: id,
              payload: {
                version: next.approvedVersion,
                status: next.status,
                // Slack and Basecamp posts: "draft" = leave a draft Andrés sends himself (Slack draft; Basecamp status "drafted"),
                // "send" = send it (Slack connector; Basecamp status "active"). Null elsewhere.
                mode: next.sendMode,
                // A salida that waited for its source must re-read the thread before sending.
                recheckThread: ev.type === "resume",
              },
            },
            now,
          );
        }
        return repo.detail(id);
      });
    },

    /** Apply every time-driven transition due at `now` (undo window over, schedule reached, expiry). */
    sweep(now = new Date()): string[] {
      const rows = db
        .prepare(
          `SELECT * FROM salidas WHERE
             ((status = 'sending' AND released_at IS NULL AND undo_until <= ?)
          OR (status = 'scheduled' AND send_at <= ?)
          OR (status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?))
           AND is_sample = 0`,
        )
        .all(nowIso(now), nowIso(now), nowIso(now));
      const touched: string[] = [];
      for (const s of fromRows<Salida>(rows, S_SPEC)) {
        const ev = dueEvent(s, now);
        if (!ev) continue;
        try {
          repo.transition(s.id, ev, now);
          touched.push(s.id);
        } catch (err) {
          if (!(err instanceof TransitionError)) throw err;
        }
      }
      return touched;
    },
  };
  return repo;
}
