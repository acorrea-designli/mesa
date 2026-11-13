// t125: PDF review marks. Repository over :memory:, the wake they send and the summary the context carries.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { ForbiddenError, NotFoundError, TransitionError, ValidationError } from "../db/util";
import { eventsAfter } from "../wake/wake";
import { createRepos, type Repos } from "./index";
import { asCliCall, lastInteractionAt } from "./interaction";

let r: Repos;
let ref: string;
let id: string;
let pdf: string;
const T0 = new Date("2026-11-12T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
  const t = r.tickets.create({ direction: "andres_asks", title: "Informe", body: "Revisa", ownerSession: "lead" }, T0);
  ref = t.ref;
  id = t.id;
  pdf = r.tickets.addAttachment(id, { messageId: null, filename: "informe.pdf", mime: "application/pdf", size: 10, path: `${id}/f-informe.pdf` }, T0).id;
});

const note = (o: Partial<{ page: number; x: number; y: number; body: string }> = {}, ms = 1) =>
  r.annotations.create(ref, { attachmentId: pdf, page: o.page ?? 1, kind: "note", geometry: { x: o.x ?? 10, y: o.y ?? 10 }, body: o.body ?? "mira esto", author: "andres" }, at(ms));
const wakes = () => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === "ticket.annotations");

describe("create", () => {
  it("stores each kind in page units with its bounding box, quote and comment", () => {
    const h = r.annotations.create(
      ref,
      { attachmentId: pdf, page: 2, kind: "highlight", geometry: { rects: [{ x: 50, y: 100, w: 200, h: 12 }] }, quote: "  Costo mensual  ", body: "¿incluye IVA?", author: "andres" },
      at(1),
    );
    expect(h).toMatchObject({ page: 2, kind: "highlight", quote: "Costo mensual", body: "¿incluye IVA?", author: "andres", state: "open", sentAt: null, rect: { x: 50, y: 100, w: 200, h: 12 }, replies: [] });
    const a = r.annotations.create(ref, { attachmentId: pdf, page: 1, kind: "arrow", geometry: { x1: 10, y1: 90, x2: 60, y2: 30 }, author: "andres" }, at(2));
    expect(a.rect).toEqual({ x: 10, y: 30, w: 50, h: 60 });
    expect(a.quote).toBe("");
    expect(r.annotations.create(ref, { attachmentId: pdf, page: 1, kind: "ellipse", geometry: { x: 1, y: 1, w: 5, h: 5 }, author: "andres" }, at(3)).kind).toBe("ellipse");
    expect(note().rect).toEqual({ x: 10, y: 10, w: 0, h: 0 });
  });

  it("refuses bad input without writing", () => {
    const bad = (o: Partial<Parameters<Repos["annotations"]["create"]>[1]>) => () =>
      r.annotations.create(ref, { attachmentId: pdf, page: 1, kind: "note", geometry: { x: 1, y: 1 }, author: "andres", ...o }, at(1));
    expect(bad({ page: 0 })).toThrow(ValidationError);
    expect(bad({ page: 1.5 })).toThrow(ValidationError);
    expect(bad({ geometry: { x: 1 } })).toThrow(ValidationError);
    expect(bad({ kind: "highlight", geometry: { rects: [{ x: 1, y: 1, w: 1, h: 1 }] } })).toThrow(/quoted text/);
    expect(bad({ body: "x".repeat(8001) })).toThrow(ValidationError);
    expect(bad({ attachmentId: "at_nope" })).toThrow(NotFoundError);
    expect(r.annotations.list(ref)).toEqual([]);
  });

  it("only accepts a PDF of this ticket", () => {
    const png = r.tickets.addAttachment(id, { messageId: null, filename: "a.png", mime: "image/png", size: 1, path: "x/a.png" }, T0).id;
    expect(() => r.annotations.create(ref, { attachmentId: png, page: 1, kind: "note", geometry: { x: 1, y: 1 }, author: "andres" })).toThrow(/not a PDF/);
    const other = r.tickets.create({ direction: "andres_asks", title: "Otro", body: "x", ownerSession: "lead" }, T0);
    expect(() => r.annotations.create(other.ref, { attachmentId: pdf, page: 1, kind: "note", geometry: { x: 1, y: 1 }, author: "andres" })).toThrow(NotFoundError);
  });
});

describe("list", () => {
  it("is ordered by page then position, filtered by PDF and by open", () => {
    const b = note({ page: 2, y: 5, body: "b" }, 1);
    const c = note({ page: 1, y: 300, body: "c" }, 2);
    const a = note({ page: 1, y: 20, body: "a" }, 3);
    expect(r.annotations.list(ref).map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    r.annotations.update(ref, c.id, { state: "resolved" }, "andres", at(4));
    expect(r.annotations.list(ref, { open: true }).map((x) => x.id)).toEqual([a.id, b.id]);
    const pdf2 = r.tickets.addAttachment(id, { messageId: null, filename: "otro.pdf", mime: "application/pdf", size: 1, path: "x/o.pdf" }, at(5)).id;
    expect(r.annotations.list(ref, { attachmentId: pdf2 })).toEqual([]);
    expect(r.annotations.list(ref, { attachmentId: pdf })).toHaveLength(3);
  });
});

describe("update and remove", () => {
  it("lets only the author edit the comment or delete; anyone resolves", () => {
    const a = note();
    expect(() => r.annotations.update(ref, a.id, { body: "de claude" }, "claude")).toThrow(ForbiddenError);
    expect(r.annotations.update(ref, a.id, { state: "resolved" }, "claude", at(2)).state).toBe("resolved");
    expect(r.annotations.update(ref, a.id, { body: "mejor así" }, "andres", at(3)).body).toBe("mejor así");
    expect(() => r.annotations.update(ref, a.id, {}, "andres")).toThrow(ValidationError);
    expect(() => r.annotations.remove(ref, a.id, "claude")).toThrow(ForbiddenError);
    r.annotations.remove(ref, a.id, "andres");
    expect(r.annotations.list(ref)).toEqual([]);
    expect(() => r.annotations.get(ref, a.id)).toThrow(NotFoundError);
  });

  it("deleting a mark deletes its replies", () => {
    const a = note();
    r.annotations.reply(ref, a.id, { author: "claude", body: "visto" }, at(2));
    r.annotations.remove(ref, a.id, "andres");
    expect((r.db.prepare("SELECT COUNT(*) AS n FROM annotation_replies").get() as { n: number }).n).toBe(0);
  });
});

describe("replies", () => {
  it("keeps both sides in order and lists them on the mark", () => {
    const a = note();
    r.annotations.reply(ref, a.id, { author: "claude", body: "Es sin IVA" }, at(2));
    const back = r.annotations.reply(ref, a.id, { author: "andres", body: "Ok, anótalo" }, at(3));
    expect(back.replies.map((x) => [x.author, x.body])).toEqual([
      ["claude", "Es sin IVA"],
      ["andres", "Ok, anótalo"],
    ]);
    expect(() => r.annotations.reply(ref, a.id, { author: "andres", body: "  " })).toThrow(ValidationError);
  });
});

describe("send (Enviar a Claude)", () => {
  it("sends ONE wake for the marks not sent yet, then none until something new", () => {
    const a = note({ body: "uno" }, 1);
    const b = note({ page: 2, body: "dos" }, 2);
    expect(r.annotations.pending(ref, pdf).map((x) => x.id)).toEqual([a.id, b.id]);
    const sent = r.annotations.send(ref, pdf, at(10));
    expect(sent).toEqual({ count: 2, annotationIds: [a.id, b.id] });
    const ws = wakes();
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ sessionId: "lead", entityType: "ticket", entityId: id, payload: { ref, ticketRef: ref, attachmentId: pdf, annotationIds: [a.id, b.id], count: 2 } });
    expect(r.annotations.get(ref, a.id).sentAt).toBe(at(10).toISOString());
    expect(() => r.annotations.send(ref, pdf, at(11))).toThrow(TransitionError);
    expect(wakes()).toHaveLength(1);

    const c = note({ body: "tres" }, 12);
    expect(r.annotations.send(ref, pdf, at(13))).toEqual({ count: 1, annotationIds: [c.id] });
    expect(wakes()).toHaveLength(2);
  });

  it("carries again a mark Andrés edited, replied to or reopened after sending; never resolved ones or Claude's own", () => {
    const a = note({ body: "uno" }, 1);
    const resolved = note({ body: "dos" }, 2);
    r.annotations.create(ref, { attachmentId: pdf, page: 1, kind: "note", geometry: { x: 5, y: 5 }, body: "de claude", author: "claude" }, at(3));
    r.annotations.update(ref, resolved.id, { state: "resolved" }, "andres", at(4));
    expect(r.annotations.send(ref, pdf, at(5)).annotationIds).toEqual([a.id]);
    r.annotations.reply(ref, a.id, { author: "claude", body: "visto" }, at(6));
    expect(r.annotations.pending(ref, pdf)).toEqual([]); // Claude's reply is not something to send back
    r.annotations.reply(ref, a.id, { author: "andres", body: "gracias" }, at(7));
    expect(r.annotations.pending(ref, pdf).map((x) => x.id)).toEqual([a.id]);
    r.annotations.send(ref, pdf, at(8));
    r.annotations.update(ref, a.id, { body: "uno, editado" }, "andres", at(9));
    expect(r.annotations.pending(ref, pdf)).toHaveLength(1);
    r.annotations.send(ref, pdf, at(10));
    r.annotations.update(ref, resolved.id, { state: "open" }, "andres", at(11));
    expect(r.annotations.pending(ref, pdf).map((x) => x.id)).toEqual([resolved.id]);
  });

  it("counts as Andrés acting: Te espera becomes Espera a Claude, and stamps his interaction", () => {
    r.tickets.addMessage(ref, { author: "claude", body: "¿Revisas el informe?", ask: true }, at(1));
    expect(r.tickets.get(ref).status).toBe("waiting_andres");
    note({ body: "x" }, 2);
    r.annotations.send(ref, pdf, at(20));
    expect(r.tickets.get(ref).status).toBe("waiting_claude");
    expect(lastInteractionAt(r.db)).toBe(at(20).toISOString());
  });

  it("a CLI call never stamps his interaction", () => {
    asCliCall(() => r.annotations.create(ref, { attachmentId: pdf, page: 1, kind: "note", geometry: { x: 1, y: 1 }, body: "c", author: "claude" }, at(2)));
    expect(lastInteractionAt(r.db)).toBeNull();
  });
});

describe("summary (the context)", () => {
  it("counts open and total per PDF that has marks", () => {
    const pdf2 = r.tickets.addAttachment(id, { messageId: null, filename: "otro.pdf", mime: "application/pdf", size: 1, path: "x/o.pdf" }, at(1)).id;
    r.tickets.addAttachment(id, { messageId: null, filename: "sin-marcas.pdf", mime: "application/pdf", size: 1, path: "x/s.pdf" }, at(2));
    const a = note();
    note();
    r.annotations.update(ref, a.id, { state: "resolved" }, "andres", at(5));
    r.annotations.create(ref, { attachmentId: pdf2, page: 1, kind: "rect", geometry: { x: 1, y: 1, w: 2, h: 2 }, author: "andres" }, at(6));
    expect(r.annotations.summary(ref)).toEqual([
      { attachmentId: pdf, filename: "informe.pdf", open: 1, total: 2 },
      { attachmentId: pdf2, filename: "otro.pdf", open: 1, total: 1 },
    ]);
    expect(r.agents.context(ref).annotations).toEqual(r.annotations.summary(ref));
  });
});

// t147: general comments, the pageless kind (page 0 = the whole document, N = that page).
const general = (o: Partial<{ page: number; body: string; author: "andres" | "claude" }> = {}, ms = 1) =>
  r.annotations.create(ref, { attachmentId: pdf, page: o.page ?? 0, kind: "comment", geometry: {}, body: o.body ?? "en general", author: o.author ?? "andres" }, at(ms));

describe("general comments", () => {
  it("stores a comment with no geometry on the whole document or on a page", () => {
    const doc = general({ body: "  todo el informe  " });
    expect(doc).toMatchObject({ page: 0, kind: "comment", geometry: {}, rect: { x: 0, y: 0, w: 0, h: 0 }, quote: "", body: "todo el informe", author: "andres", state: "open", sentAt: null, replies: [] });
    expect(general({ page: 3 }, 2)).toMatchObject({ page: 3, kind: "comment", geometry: {} });
    // geometry is ignored, not required
    const g = r.annotations.create(ref, { attachmentId: pdf, page: 1, kind: "comment", geometry: { x: 9, y: 9 }, body: "x", author: "andres" }, at(3));
    expect(g.geometry).toEqual({});
  });

  it("validates the page: 0 only for a comment, never negative, whole numbers, and a body is required", () => {
    const bad = (o: Partial<Parameters<Repos["annotations"]["create"]>[1]>) => () =>
      r.annotations.create(ref, { attachmentId: pdf, page: 0, kind: "comment", geometry: {}, body: "x", author: "andres", ...o }, at(1));
    expect(bad({ page: -1 })).toThrow(ValidationError);
    expect(bad({ page: 1.5 })).toThrow(ValidationError);
    expect(bad({ page: 100_001 })).toThrow(ValidationError);
    expect(bad({ body: "   " })).toThrow(/needs a body/);
    expect(bad({ body: undefined })).toThrow(/needs a body/);
    expect(bad({ kind: "note", geometry: { x: 1, y: 1 }, page: 0 })).toThrow(ValidationError); // a pin still needs a page
    expect(bad({ kind: "rect", geometry: { x: 1, y: 1, w: 2, h: 2 }, page: 0 })).toThrow(ValidationError);
    expect(r.annotations.list(ref)).toEqual([]);
  });

  it("lists whole-document comments first, then page by page: its comments before its anchored marks", () => {
    const pin1 = note({ page: 1, x: 0, y: 0, body: "pin 1" }, 1);
    const p2 = general({ page: 2, body: "página 2" }, 2);
    const pin2 = note({ page: 2, x: 0, y: 0, body: "pin 2" }, 3);
    const p1 = general({ page: 1, body: "página 1" }, 4);
    const lateDoc = general({ body: "doc tarde" }, 6);
    const doc = general({ body: "doc" }, 5);
    expect(r.annotations.list(ref, { attachmentId: pdf }).map((x) => x.id)).toEqual([doc.id, lateDoc.id, p1.id, pin1.id, p2.id, pin2.id]);
    expect(r.annotations.list(ref, { open: true }).map((x) => x.page)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("is editable (never emptied), resolvable, reopenable, repliable and deletable like any mark", () => {
    const c = general({ body: "uno" });
    expect(() => r.annotations.update(ref, c.id, { body: "  " }, "andres", at(2))).toThrow(/needs a body/);
    expect(r.annotations.update(ref, c.id, { body: "dos" }, "andres", at(3)).body).toBe("dos");
    expect(() => r.annotations.update(ref, c.id, { body: "mío" }, "claude", at(4))).toThrow(ForbiddenError);
    expect(r.annotations.update(ref, c.id, { state: "resolved" }, "claude", at(5)).state).toBe("resolved");
    expect(r.annotations.update(ref, c.id, { state: "open" }, "andres", at(6)).state).toBe("open");
    const replied = r.annotations.reply(ref, c.id, { author: "claude", body: "hecho" }, at(7));
    expect(replied.replies.map((x) => [x.author, x.body])).toEqual([["claude", "hecho"]]);
    expect(() => r.annotations.remove(ref, c.id, "claude", at(8))).toThrow(ForbiddenError);
    r.annotations.remove(ref, c.id, "andres", at(9));
    expect(r.annotations.list(ref)).toEqual([]);
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM annotation_replies").get()).toMatchObject({ n: 0 });
  });

  it("send: ONE wake with the unchanged payload, carrying the PDF's other unsent marks; (n) drops to 0", () => {
    const pin = note({ body: "pin" }, 1);
    const c = general({ body: "general" }, 2);
    expect(r.annotations.pending(ref, pdf).map((x) => x.id)).toEqual([c.id, pin.id]);
    const sent = r.annotations.send(ref, pdf, at(10));
    expect(sent).toEqual({ count: 2, annotationIds: [c.id, pin.id] });
    const ws = wakes();
    expect(ws).toHaveLength(1);
    expect(ws[0]!.payload).toEqual({ ref, ticketRef: ref, attachmentId: pdf, annotationIds: [c.id, pin.id], count: 2 });
    expect(r.annotations.pending(ref, pdf)).toEqual([]);
    expect(r.annotations.get(ref, c.id).sentAt).toBe(at(10).toISOString());
    expect(() => r.annotations.send(ref, pdf, at(11))).toThrow(TransitionError);
    expect(wakes()).toHaveLength(1);
  });

  it("an edit, a reopen or a reply by Andrés makes it unsent again; resolved and Claude's own are never sent", () => {
    const c = general({ body: "uno" }, 1);
    const done = general({ body: "cerrado", page: 2 }, 2);
    general({ body: "de claude", author: "claude" }, 3);
    r.annotations.update(ref, done.id, { state: "resolved" }, "andres", at(4));
    r.annotations.send(ref, pdf, at(5));
    expect(wakes()[0]!.payload).toMatchObject({ annotationIds: [c.id], count: 1 });
    r.annotations.update(ref, c.id, { body: "uno, editado" }, "andres", at(6));
    expect(r.annotations.pending(ref, pdf).map((x) => x.id)).toEqual([c.id]);
    r.annotations.send(ref, pdf, at(7));
    r.annotations.reply(ref, c.id, { author: "andres", body: "ojo" }, at(8));
    expect(r.annotations.pending(ref, pdf).map((x) => x.id)).toEqual([c.id]);
    r.annotations.send(ref, pdf, at(9));
    r.annotations.update(ref, done.id, { state: "open" }, "andres", at(10));
    expect(r.annotations.pending(ref, pdf).map((x) => x.id)).toEqual([done.id]);
  });

  it("counts like any mark: the context summary and Documentos (Andrés's own, open / total)", () => {
    const c = general({ body: "uno" }, 1);
    general({ page: 2, body: "dos" }, 2);
    general({ body: "de claude", author: "claude" }, 3);
    note();
    r.annotations.update(ref, c.id, { state: "resolved" }, "andres", at(5));
    expect(r.annotations.summary(ref)).toEqual([{ attachmentId: pdf, filename: "informe.pdf", open: 3, total: 4 }]);
    expect(r.agents.context(ref).annotations).toEqual(r.annotations.summary(ref));
    expect(r.annotations.documents().find((d) => d.attachmentId === pdf)).toMatchObject({ open: 2, total: 3 });
  });
});
