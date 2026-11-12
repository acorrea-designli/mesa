// t135: Tickets · Documentos. The documents query (every PDF of every ticket, newest first, with Andrés's marks)
// and "Terminé": a flag on the attachment that is the only source of the done state.
import { beforeEach, describe, expect, it } from "vitest";
import { loadTickets } from "@/features/tickets/read";
import { openDb } from "../db/sqlite";
import { NotFoundError, ValidationError } from "../db/util";
import { createRepos, type Repos } from "./index";

let r: Repos;
const T0 = new Date("2026-11-12T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

const ticket = (title: string, ms = 0) => r.tickets.create({ direction: "andres_asks", title, body: "x", ownerSession: "lead" }, at(ms));
const pdf = (id: string, filename: string, ms: number) => r.tickets.addAttachment(id, { messageId: null, filename, mime: "application/pdf", size: 10, path: `${id}/${filename}` }, at(ms));
const mark = (ref: string, attachmentId: string, author: "andres" | "claude" = "andres") =>
  r.annotations.create(ref, { attachmentId, page: 1, kind: "note", geometry: { x: 1, y: 1 }, body: "n", author }, at(50));

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
});

describe("documents", () => {
  it("is empty without PDFs", () => {
    ticket("Sin adjuntos");
    expect(r.annotations.documents()).toEqual([]);
  });

  it("lists only PDFs, of every ticket open or closed, newest first, with ticket and size", () => {
    const a = ticket("Informe", 1);
    const b = ticket("Propuesta", 2);
    const old = pdf(a.id, "viejo.pdf", 10);
    r.tickets.addAttachment(a.id, { messageId: null, filename: "foto.png", mime: "image/png", size: 1, path: "x/foto.png" }, at(15));
    const recent = pdf(b.id, "nuevo.pdf", 20);
    r.tickets.transition(b.id, { type: "close" }, "lead", at(30));
    const docs = r.annotations.documents();
    expect(docs.map((d) => d.attachmentId)).toEqual([recent.id, old.id]);
    expect(docs[0]).toMatchObject({ filename: "nuevo.pdf", size: 10, ticketId: b.id, ticketRef: b.ref, ticketTitle: "Propuesta", ticketStatus: "closed", isSample: false, createdAt: at(20).toISOString() });
    expect(docs[1]).toMatchObject({ ticketRef: a.ref, ticketStatus: "waiting_claude" });
  });

  it("counts Andrés's marks, open and total; Claude's marks are not his notes", () => {
    const t = ticket("Informe");
    const d = pdf(t.id, "a.pdf", 5);
    const other = pdf(t.id, "b.pdf", 6);
    const m1 = mark(t.ref, d.id);
    mark(t.ref, d.id);
    mark(t.ref, d.id, "claude");
    r.annotations.update(t.ref, m1.id, { state: "resolved" }, "andres", at(60));
    const docs = new Map(r.annotations.documents().map((x) => [x.attachmentId, x]));
    expect(docs.get(d.id)).toMatchObject({ open: 1, total: 2 });
    expect(docs.get(other.id)).toMatchObject({ open: 0, total: 0 });
  });
});

describe("Terminé", () => {
  it("is pendiente until Andrés marks it, and he can undo it", () => {
    const t = ticket("Informe");
    const d = pdf(t.id, "a.pdf", 5);
    expect(r.annotations.documents()[0]!.reviewedAt).toBeNull();
    const done = r.annotations.setReviewed(t.ref, d.id, true, at(100));
    expect(done.reviewedAt).toBe(at(100).toISOString());
    expect(r.annotations.documents()[0]!.reviewedAt).toBe(at(100).toISOString());
    expect(r.tickets.detail(t.id).attachments[0]!.reviewedAt).toBe(at(100).toISOString());
    expect(r.annotations.setReviewed(t.ref, d.id, false, at(200)).reviewedAt).toBeNull();
    expect(r.annotations.documents()[0]!.reviewedAt).toBeNull();
  });

  it("never follows the marks: no notes is not done, every mark resolved is not done", () => {
    const t = ticket("Informe");
    const d = pdf(t.id, "a.pdf", 5);
    const m = mark(t.ref, d.id);
    r.annotations.update(t.ref, m.id, { state: "resolved" }, "andres", at(60));
    expect(r.annotations.documents()[0]).toMatchObject({ open: 0, total: 1, reviewedAt: null });
    r.annotations.setReviewed(t.ref, d.id, true, at(70));
    r.annotations.update(t.ref, m.id, { state: "open" }, "andres", at(80));
    expect(r.annotations.documents()[0]).toMatchObject({ open: 1, total: 1 });
    expect(r.annotations.documents()[0]!.reviewedAt).not.toBeNull();
  });

  it("only applies to a PDF of this ticket", () => {
    const t = ticket("Informe");
    const other = ticket("Otro");
    const d = pdf(t.id, "a.pdf", 5);
    const png = r.tickets.addAttachment(t.id, { messageId: null, filename: "a.png", mime: "image/png", size: 1, path: "x/a.png" }, T0);
    expect(() => r.annotations.setReviewed(t.ref, png.id, true)).toThrow(ValidationError);
    expect(() => r.annotations.setReviewed(other.ref, d.id, true)).toThrow(NotFoundError);
    expect(r.annotations.documents()[0]!.reviewedAt).toBeNull();
  });
});

describe("Tickets tab=docs", () => {
  it("carries the count on every tab and the rows only on Documentos, without a thread", () => {
    const t = ticket("Informe");
    pdf(t.id, "a.pdf", 5);
    const open = loadTickets(r, {}, at(1000));
    expect(open.counts.docs).toBe(1);
    expect(open.docs).toEqual([]);
    const docs = loadTickets(r, { tab: "docs", selected: t.ref }, at(1000));
    expect(docs.tab).toBe("docs");
    expect(docs.docs).toHaveLength(1);
    expect(docs.rows).toEqual([]);
    expect(docs.selected).toBeNull();
  });
});
