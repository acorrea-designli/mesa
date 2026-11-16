// t190: one document with versions. `addAttachment` with `versionOf` stores v2, v3... of the same document; marks stay
// on the version they were made on; Documentos shows one row per document; the context and the marks carry the version.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { NotFoundError } from "../db/util";
import { createRepos, type Repos } from "./index";
import { eventsAfter } from "../wake/wake";

let r: Repos;
const T0 = new Date("2026-11-16T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
let tid: string;
let ref: string;

const add = (filename: string, ms: number, versionOf?: string, ticketId = tid, mime = "application/pdf") =>
  r.tickets.addAttachment(ticketId, { messageId: null, filename, mime, size: 10, path: `${ticketId}/${filename}`, versionOf }, at(ms));
const mark = (attachmentId: string, author: "andres" | "claude" = "andres") =>
  r.annotations.create(ref, { attachmentId, page: 1, kind: "note", geometry: { x: 1, y: 1 }, body: "n", author }, at(500));

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
  const t = r.tickets.create({ direction: "andres_asks", title: "Informe", body: "x", ownerSession: "lead" }, T0);
  tid = t.id;
  ref = t.ref;
});

describe("addAttachment --version-of", () => {
  it("is v1 with no root by default", () => {
    const a = add("informe.pdf", 1);
    expect(a).toMatchObject({ version: 1, versionOf: null });
  });

  it("stores v2 and v3 of the same document, whichever version's id is given", () => {
    const v1 = add("informe.pdf", 1);
    const v2 = add("informe-v2.pdf", 2, v1.id);
    const v3 = add("informe-v3.pdf", 3, v2.id);
    expect(v2).toMatchObject({ version: 2, versionOf: v1.id });
    expect(v3).toMatchObject({ version: 3, versionOf: v1.id });
    expect(r.tickets.detail(tid).attachments.map((a) => a.version)).toEqual([1, 2, 3]);
  });

  it("refuses a version when it is a PDF and its document is not, or the other way round, and accepts other type differences", () => {
    const v1 = add("informe.pdf", 1);
    expect(() => add("foto.png", 2, v1.id, tid, "image/png")).toThrow(/must be a PDF/);
    expect(r.tickets.detail(tid).attachments).toHaveLength(1);
    const doc = add("notas.md", 3, undefined, tid, "text/markdown");
    expect(() => add("notas.pdf", 4, doc.id)).toThrow(/must not be a PDF/);
    expect(add("notas.txt", 5, doc.id, tid, "application/octet-stream")).toMatchObject({ version: 2, versionOf: doc.id });
  });

  it("is 404 for an attachment that does not exist or belongs to another ticket", () => {
    const other = r.tickets.create({ direction: "andres_asks", title: "Otro", body: "x", ownerSession: "lead" }, T0);
    const foreign = add("ajeno.pdf", 1, undefined, other.id);
    expect(() => add("x.pdf", 2, "at_nope")).toThrow(NotFoundError);
    expect(() => add("x.pdf", 2, foreign.id)).toThrow(NotFoundError);
    expect(r.tickets.detail(tid).attachments).toEqual([]);
  });
});

describe("marks stay on their version", () => {
  it("each mark carries the version it was made on and lists per version", () => {
    const v1 = add("informe.pdf", 1);
    const v2 = add("informe-v2.pdf", 2, v1.id);
    const m1 = mark(v1.id);
    const m2 = mark(v2.id);
    expect(m1.version).toBe(1);
    expect(m2.version).toBe(2);
    expect(r.annotations.list(ref, { attachmentId: v1.id }).map((m) => m.id)).toEqual([m1.id]);
    expect(r.annotations.list(ref, { attachmentId: v2.id }).map((m) => m.id)).toEqual([m2.id]);
    expect(r.annotations.list(ref).map((m) => m.version).sort()).toEqual([1, 2]);
  });
});

describe("documents (Documentos)", () => {
  it("shows one row per document: the latest version, with the history and each version's own marks", () => {
    const v1 = add("informe.pdf", 1);
    const other = add("propuesta.pdf", 5);
    const v2 = add("informe-v2.pdf", 10, v1.id);
    mark(v1.id);
    mark(v1.id);
    mark(v2.id);
    const docs = r.annotations.documents();
    expect(docs.map((d) => d.attachmentId)).toEqual([v2.id, other.id]);
    const d = docs[0]!;
    expect(d).toMatchObject({ version: 2, filename: "informe-v2.pdf", open: 1, total: 1 });
    expect(d.history.map((h) => [h.attachmentId, h.version, h.open, h.total])).toEqual([
      [v1.id, 1, 2, 2],
      [v2.id, 2, 1, 1],
    ]);
    expect(docs[1]).toMatchObject({ version: 1, history: [expect.objectContaining({ attachmentId: other.id })] });
  });

  it("reviewing the latest version does not touch the older one", () => {
    const v1 = add("informe.pdf", 1);
    const v2 = add("informe-v2.pdf", 2, v1.id);
    r.annotations.setReviewed(ref, v2.id, true, at(100));
    const d = r.annotations.documents()[0]!;
    expect(d.reviewedAt).not.toBeNull();
    expect(d.history[0]!.reviewedAt).toBeNull();
  });
});

describe("context", () => {
  it("carries the version in the marks' summary and lists the documents with their latest version", () => {
    const v1 = add("informe.pdf", 1);
    const v2 = add("informe-v2.pdf", 2, v1.id);
    add("foto.png", 3, undefined, tid, "image/png");
    mark(v1.id);
    mark(v2.id);
    const c = r.agents.context(ref);
    expect(c.annotations).toEqual([
      { attachmentId: v1.id, filename: "informe.pdf", version: 1, versions: 2, open: 1, total: 1 },
      { attachmentId: v2.id, filename: "informe-v2.pdf", version: 2, versions: 2, open: 1, total: 1 },
    ]);
    expect(c.documents).toEqual([
      { documentId: v1.id, latestAttachmentId: v2.id, filename: "informe-v2.pdf", mime: "application/pdf", version: 2, versions: 2, approvedVersion: null },
      expect.objectContaining({ filename: "foto.png", version: 1, versions: 1 }),
    ]);
  });
});

describe("Aprobar (approval of a version)", () => {
  const wakes = () => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === "ticket.document_approved");

  it("approves one version, wakes the owner once with the version, and shows it in documents and the context", () => {
    const v1 = add("informe.pdf", 1);
    const v2 = add("informe-v2.pdf", 2, v1.id);
    const a = r.annotations.setApproved(ref, v1.id, true, at(100));
    expect(a.approvedAt).toBe(at(100).toISOString());
    expect(wakes()).toHaveLength(1);
    expect(wakes()[0]!.payload).toEqual({ ref, ticketRef: ref, attachmentId: v1.id, version: 1 });
    const d = r.annotations.documents()[0]!;
    expect(d.approvedAt).toBeNull();
    expect(d.history.map((h) => h.approvedAt !== null)).toEqual([true, false]);
    expect(r.agents.context(ref).documents[0]).toMatchObject({ latestAttachmentId: v2.id, approvedVersion: 1 });
  });

  it("approving again changes nothing and wakes nobody; taking it back wakes nobody either", () => {
    const v1 = add("informe.pdf", 1);
    r.annotations.setApproved(ref, v1.id, true, at(100));
    r.annotations.setApproved(ref, v1.id, true, at(200));
    expect(wakes()).toHaveLength(1);
    expect(r.tickets.detail(tid).attachments[0]!.approvedAt).toBe(at(100).toISOString());
    expect(r.annotations.setApproved(ref, v1.id, false, at(300)).approvedAt).toBeNull();
    expect(wakes()).toHaveLength(1);
    r.annotations.setApproved(ref, v1.id, true, at(400));
    expect(wakes()).toHaveLength(2);
  });

  it("is 404 for another ticket's attachment and 400 for a file that is not a PDF", () => {
    const png = add("a.png", 1, undefined, tid, "image/png");
    expect(() => r.annotations.setApproved(ref, png.id, true)).toThrow(/not a PDF/);
    expect(() => r.annotations.setApproved(ref, "at_nope", true)).toThrow(NotFoundError);
    expect(wakes()).toEqual([]);
  });
});
