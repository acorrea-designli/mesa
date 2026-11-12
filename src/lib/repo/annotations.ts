// PDF review marks (t125): annotations on a ticket's PDF attachment and their replies. Andrés makes marks and
// replies in the review view; Claude reads them (mesa ticket annotations) and replies per annotation. Nothing here
// wakes Claude until Andrés presses "Enviar a Claude": one ticket.annotations wake for the marks not sent yet.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRow, fromRows, ForbiddenError, newId, NotFoundError, nowIso, TransitionError, ValidationError } from "../db/util";
import { boundsOf, byPosition, MAX_BODY, MAX_QUOTE, parseGeometry } from "../domain/annotations";
import type { Annotation, AnnotationKind, AnnotationReply, AnnotationState, AnnotationSummary, Attachment, Author } from "../domain/types";
import { emitWake } from "../wake/wake";
import { touchInteraction } from "./interaction";
import { ticketsRepo } from "./tickets";

const SPEC = { json: ["geometry"] };

export interface AnnotationInput {
  attachmentId: string;
  page: number;
  kind: AnnotationKind;
  geometry: unknown;
  quote?: string;
  body?: string;
  author: Author;
}

export interface AnnotationListFilter {
  attachmentId?: string;
  open?: boolean;
}

export function annotationsRepo(db: Db) {
  const tickets = ticketsRepo(db);

  /** The ticket's PDF attachment: 404 when it is not on this ticket, 400 when it is not a PDF. */
  const pdfOf = (ticketId: string, attachmentId: string): Attachment => {
    const row = db.prepare("SELECT * FROM attachments WHERE id = ? AND ticket_id = ?").get(attachmentId, ticketId);
    if (!row) throw new NotFoundError("attachment", attachmentId);
    const att = fromRow<Attachment>(row);
    if (att.mime !== "application/pdf") throw new ValidationError(`attachment ${att.id} is not a PDF`);
    return att;
  };

  const repliesOf = (ids: string[]): Map<string, AnnotationReply[]> => {
    const out = new Map<string, AnnotationReply[]>();
    if (!ids.length) return out;
    const rows = fromRows<AnnotationReply>(
      db.prepare(`SELECT * FROM annotation_replies WHERE annotation_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at, rowid`).all(...ids),
    );
    for (const r of rows) out.set(r.annotationId, [...(out.get(r.annotationId) ?? []), r]);
    return out;
  };

  const hydrate = (rows: unknown[]): Annotation[] => {
    const base = fromRows<Omit<Annotation, "rect" | "replies">>(rows, SPEC);
    const replies = repliesOf(base.map((a) => a.id));
    return base.map((a) => ({ ...a, rect: boundsOf(a.kind, a.geometry), replies: replies.get(a.id) ?? [] })).sort(byPosition);
  };

  const one = (ticketId: string, annId: string): Annotation => {
    const row = db.prepare("SELECT * FROM annotations WHERE id = ? AND ticket_id = ?").get(annId, ticketId);
    if (!row) throw new NotFoundError("annotation", annId);
    return hydrate([row])[0]!;
  };

  const text = (v: string | undefined, max: number, what: string): string => {
    const t = (v ?? "").trim();
    if (t.length > max) throw new ValidationError(`${what} is longer than ${max} characters`);
    return t;
  };

  const list = (ticketId: string, f: AnnotationListFilter = {}): Annotation[] => {
    const where = ["ticket_id = ?"];
    const args: string[] = [ticketId];
    if (f.attachmentId) {
      where.push("attachment_id = ?");
      args.push(f.attachmentId);
    }
    if (f.open) where.push("state = 'open'");
    return hydrate(db.prepare(`SELECT * FROM annotations WHERE ${where.join(" AND ")}`).all(...args));
  };

  return {
    /** The ticket's marks in reading order (page, top to bottom, left to right), with their replies. */
    list(id: string, f: AnnotationListFilter = {}): Annotation[] {
      const t = tickets.get(id);
      if (f.attachmentId) pdfOf(t.id, f.attachmentId);
      return list(t.id, f);
    },

    get(id: string, annId: string): Annotation {
      return one(tickets.get(id).id, annId);
    },

    /** A new mark. Andrés's start unsent; Claude's are never sent anywhere. */
    create(id: string, input: AnnotationInput, now = new Date()): Annotation {
      return tx(db, () => {
        const t = tickets.get(id);
        pdfOf(t.id, input.attachmentId);
        if (!Number.isInteger(input.page) || input.page < 1 || input.page > 100_000) throw new ValidationError("page must be a whole number from 1");
        const g = parseGeometry(input.kind, input.geometry);
        if (!g.ok) throw new ValidationError(g.problem);
        const quote = text(input.quote, MAX_QUOTE, "quote");
        if (input.kind === "highlight" && !quote) throw new ValidationError("a highlight needs the quoted text");
        const ts = nowIso(now);
        const annId = newId("an");
        db.prepare(
          `INSERT INTO annotations (id, ticket_id, attachment_id, page, kind, geometry, quote, body, author, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        ).run(annId, t.id, input.attachmentId, input.page, input.kind, JSON.stringify(g.geometry), input.kind === "highlight" ? quote : "", text(input.body, MAX_BODY, "body"), input.author, ts, ts);
        if (input.author === "andres") touchInteraction(db, now);
        return one(t.id, annId);
      });
    },

    /**
     * Edit a mark. The comment is its author's to change (403 otherwise); anyone can resolve or reopen it. What
     * Andrés changes (his comment, or reopening) is unsent again: the next "Enviar a Claude" carries it.
     */
    update(id: string, annId: string, patch: { body?: string; state?: AnnotationState }, by: Author, now = new Date()): Annotation {
      return tx(db, () => {
        const t = tickets.get(id);
        const a = one(t.id, annId);
        if (patch.body === undefined && patch.state === undefined) throw new ValidationError("nothing to change: send body or state");
        if (patch.body !== undefined && a.author !== by) throw new ForbiddenError("only the author can edit the comment of a mark");
        const body = patch.body === undefined ? a.body : text(patch.body, MAX_BODY, "body");
        const state = patch.state ?? a.state;
        const changed = body !== a.body || state !== a.state;
        const resend = by === "andres" && a.author === "andres" && (body !== a.body || (state === "open" && a.state === "resolved"));
        if (changed) {
          db.prepare("UPDATE annotations SET body = ?, state = ?, sent_at = CASE WHEN ? THEN NULL ELSE sent_at END, updated_at = ? WHERE id = ?").run(body, state, resend ? 1 : 0, nowIso(now), a.id);
        }
        if (by === "andres") touchInteraction(db, now);
        return one(t.id, a.id);
      });
    },

    /** Delete a mark and its replies (the author's only: 403 otherwise). */
    remove(id: string, annId: string, by: Author, now = new Date()): void {
      tx(db, () => {
        const t = tickets.get(id);
        const a = one(t.id, annId);
        if (a.author !== by) throw new ForbiddenError("only the author can delete a mark");
        db.prepare("DELETE FROM annotations WHERE id = ?").run(a.id);
        if (by === "andres") touchInteraction(db, now);
      });
    },

    /** A reply on a mark. Andrés's reply makes the mark unsent again (it is something new for Claude to read). */
    reply(id: string, annId: string, r: { author: Author; body: string }, now = new Date()): Annotation {
      return tx(db, () => {
        const t = tickets.get(id);
        const a = one(t.id, annId);
        const body = text(r.body, MAX_BODY, "body");
        if (!body) throw new ValidationError("a reply needs a body");
        const ts = nowIso(now);
        db.prepare("INSERT INTO annotation_replies (id, annotation_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)").run(newId("ar"), a.id, r.author, body, ts);
        db.prepare("UPDATE annotations SET updated_at = ?, sent_at = CASE WHEN ? THEN NULL ELSE sent_at END WHERE id = ?").run(ts, r.author === "andres" && a.author === "andres" ? 1 : 0, a.id);
        if (r.author === "andres") touchInteraction(db, now);
        return one(t.id, a.id);
      });
    },

    /** Andrés's open marks on a PDF that Claude has not been sent yet. */
    pending(id: string, attachmentId: string): Annotation[] {
      const t = tickets.get(id);
      pdfOf(t.id, attachmentId);
      return list(t.id, { attachmentId, open: true }).filter((a) => a.author === "andres" && a.sentAt === null);
    },

    /**
     * "Enviar a Claude (n)": ONE ticket.annotations wake for the marks not sent yet, then they are stamped sent.
     * It counts as Andrés acting on the ticket. 409 when nothing is new.
     */
    send(id: string, attachmentId: string, now = new Date()): { count: number; annotationIds: string[] } {
      return tx(db, () => {
        const t = tickets.get(id);
        const todo = this.pending(t.id, attachmentId);
        if (!todo.length) throw new TransitionError("nothing new to send: every open mark was already sent to Claude");
        const ids = todo.map((a) => a.id);
        const ts = nowIso(now);
        const mark = db.prepare("UPDATE annotations SET sent_at = ? WHERE id = ?");
        for (const x of ids) mark.run(ts, x);
        db.prepare("UPDATE tickets SET updated_at = ?, woke_at = ? WHERE id = ?").run(ts, ts, t.id);
        // ticket.annotations { ref, ticketRef, attachmentId, annotationIds, count }
        emitWake(
          db,
          { sessionId: t.ownerSession, kind: "ticket.annotations", entityType: "ticket", entityId: t.id, payload: { ref: t.ref, ticketRef: t.ref, attachmentId, annotationIds: ids, count: ids.length } },
          now,
        );
        touchInteraction(db, now);
        tickets.andresActed(t.id, now);
        return { count: ids.length, annotationIds: ids };
      });
    },

    /** Open and total marks per PDF that has any (the context's summary), ordered by attachment. */
    summary(id: string): AnnotationSummary[] {
      const t = tickets.get(id);
      return (
        db
          .prepare(
            `SELECT a.attachment_id AS attachmentId, f.filename AS filename,
                    SUM(CASE WHEN a.state = 'open' THEN 1 ELSE 0 END) AS open, COUNT(*) AS total
               FROM annotations a JOIN attachments f ON f.id = a.attachment_id
              WHERE a.ticket_id = ? GROUP BY a.attachment_id ORDER BY f.created_at, f.id`,
          )
          .all(t.id) as unknown as AnnotationSummary[]
      ).map((r) => ({ ...r }));
    },
  };
}
