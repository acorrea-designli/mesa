// t125: the PDF review routes. The author follows the caller (the CLI header makes it Claude), 403 on someone
// else's mark, one batched wake on send, zod-validated bodies.
import { beforeEach, describe, expect, it } from "vitest";
import { GET as LIST, POST as CREATE } from "@/app/api/tickets/[id]/annotations/route";
import { DELETE as REMOVE, PATCH as PATCH_ONE } from "@/app/api/tickets/[id]/annotations/[annId]/route";
import { POST as REPLY } from "@/app/api/tickets/[id]/annotations/[annId]/replies/route";
import { POST as SEND } from "@/app/api/tickets/[id]/annotations/send/route";
import { PUT as REVIEWED } from "@/app/api/tickets/[id]/attachments/[attId]/reviewed/route";
import { GET as CONTEXT } from "@/app/api/tickets/[id]/context/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { eventsAfter } from "../wake/wake";
import type { Annotation, Attachment, TicketContext } from "../domain/types";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
let ref: string;
let pdf: string;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" });
  const t = r.tickets.create({ direction: "andres_asks", title: "Informe", body: "x", ownerSession: "lead" });
  ref = t.ref;
  pdf = r.tickets.addAttachment(t.id, { messageId: null, filename: "informe.pdf", mime: "application/pdf", size: 1, path: "x/informe.pdf" }).id;
});

const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });
const call = (method: string, body?: unknown, cli = false, url = "http://local/x") =>
  new Request(url, { method, headers: { "content-type": "application/json", ...(cli ? { "x-mesa-client": "cli" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const NOTE = { attachmentId: "", page: 1, kind: "note", geometry: { x: 10, y: 20 }, body: "mira" };
const create = (o: Record<string, unknown> = {}, cli = false) => CREATE(call("POST", { ...NOTE, attachmentId: pdf, ...o }, cli), ctx({ id: ref }));

describe("POST /api/tickets/:id/annotations", () => {
  it("creates as Andrés from the board and as Claude from the CLI", async () => {
    const a = await create();
    expect(a.status).toBe(201);
    expect(((await a.json()) as Annotation).author).toBe("andres");
    const c = await create({ body: "una nota mía" }, true);
    expect(((await c.json()) as Annotation).author).toBe("claude");
  });

  it("answers 400 for a bad body, a bad geometry or a non-PDF, and 404 for an unknown ticket", async () => {
    expect((await create({ page: 0 })).status).toBe(400);
    expect((await create({ kind: "star" })).status).toBe(400);
    expect((await create({ geometry: { x: 1 } })).status).toBe(400);
    const png = r.tickets.addAttachment(r.tickets.get(ref).id, { messageId: null, filename: "a.png", mime: "image/png", size: 1, path: "x/a.png" }).id;
    expect((await create({ attachmentId: png })).status).toBe(400);
    expect((await CREATE(call("POST", { ...NOTE, attachmentId: pdf }), ctx({ id: "t999" }))).status).toBe(404);
    expect(r.annotations.list(ref)).toEqual([]);
  });
});

describe("GET /api/tickets/:id/annotations", () => {
  it("lists in reading order, filtered by att and open", async () => {
    await create({ page: 2, body: "b" });
    const a = (await (await create({ page: 1, body: "a" })).json()) as Annotation;
    await PATCH_ONE(call("PATCH", { state: "resolved" }), ctx({ id: ref, annId: a.id }));
    const all = (await (await LIST(call("GET"), ctx({ id: ref }))).json()) as Annotation[];
    expect(all.map((x) => x.body)).toEqual(["a", "b"]);
    const open = (await (await LIST(call("GET", undefined, true, `http://local/x?att=${pdf}&open=1`), ctx({ id: ref }))).json()) as Annotation[];
    expect(open.map((x) => x.body)).toEqual(["b"]);
    expect(all[0]).toMatchObject({ rect: { x: 10, y: 20, w: 0, h: 0 }, replies: [] });
  });
});

describe("PATCH, DELETE and replies", () => {
  it("403 when Claude edits or deletes Andrés's mark, and he cannot edit Claude's", async () => {
    const a = (await (await create()).json()) as Annotation;
    const p = ctx({ id: ref, annId: a.id });
    expect((await PATCH_ONE(call("PATCH", { body: "x" }, true), p)).status).toBe(403);
    expect((await REMOVE(call("DELETE", undefined, true), p)).status).toBe(403);
    expect((await PATCH_ONE(call("PATCH", { state: "resolved" }, true), p)).status).toBe(200);
    expect((await PATCH_ONE(call("PATCH", {}), p)).status).toBe(400);
    expect((await REMOVE(call("DELETE"), p)).status).toBe(204);
    expect((await REMOVE(call("DELETE"), p)).status).toBe(404);
  });

  it("a reply is Claude's from the CLI and Andrés's from the board", async () => {
    const a = (await (await create()).json()) as Annotation;
    const p = ctx({ id: ref, annId: a.id });
    expect((await REPLY(call("POST", { body: "visto" }, true), p)).status).toBe(201);
    const back = (await (await REPLY(call("POST", { body: "gracias" }), p)).json()) as Annotation;
    expect(back.replies.map((x) => x.author)).toEqual(["claude", "andres"]);
    expect((await REPLY(call("POST", { body: "" }), p)).status).toBe(400);
  });
});

describe("POST /api/tickets/:id/annotations/send", () => {
  it("sends one wake with the batch, 409 when nothing is new, 400 without a PDF", async () => {
    await create({ body: "uno" });
    await create({ body: "dos", page: 3 });
    const res = await SEND(call("POST", { attachmentId: pdf }), ctx({ id: ref }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 2 });
    const wakes = eventsAfter(r.db, "lead", 0).filter((e) => e.kind === "ticket.annotations");
    expect(wakes).toHaveLength(1);
    expect(wakes[0]!.payload).toMatchObject({ ref, ticketRef: ref, attachmentId: pdf, count: 2 });
    expect((await SEND(call("POST", { attachmentId: pdf }), ctx({ id: ref }))).status).toBe(409);
    expect((await SEND(call("POST", {}), ctx({ id: ref }))).status).toBe(400);
  });
});

describe("GET /api/tickets/:id/context", () => {
  it("carries the open count per PDF", async () => {
    await create();
    await create({ body: "dos" });
    const c = (await (await CONTEXT(call("GET", undefined, true), ctx({ id: ref }))).json()) as TicketContext;
    expect(c.annotations).toEqual([{ attachmentId: pdf, filename: "informe.pdf", open: 2, total: 2 }]);
  });
});

describe("PUT /api/tickets/:id/attachments/:attId/reviewed", () => {
  const put = (attId: string, b: unknown, id = ref) => REVIEWED(call("PUT", b), ctx({ id, attId }));

  it("marks a PDF as terminado and takes it back", async () => {
    const done = await put(pdf, { reviewed: true });
    expect(done.status).toBe(200);
    expect(((await done.json()) as Attachment).reviewedAt).not.toBeNull();
    const undone = await put(pdf, { reviewed: false });
    expect(((await undone.json()) as Attachment).reviewedAt).toBeNull();
  });

  it("answers 400 for a bad body or a non-PDF, and 404 for an unknown PDF or ticket", async () => {
    expect((await put(pdf, { reviewed: "yes" })).status).toBe(400);
    const png = r.tickets.addAttachment(r.tickets.get(ref).id, { messageId: null, filename: "a.png", mime: "image/png", size: 1, path: "x/a.png" }).id;
    expect((await put(png, { reviewed: true })).status).toBe(400);
    expect((await put("at_nope", { reviewed: true })).status).toBe(404);
    expect((await put(pdf, { reviewed: true }, "t999")).status).toBe(404);
  });
});
