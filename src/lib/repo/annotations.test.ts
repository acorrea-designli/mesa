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
