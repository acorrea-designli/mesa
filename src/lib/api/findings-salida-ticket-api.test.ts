// HTTP boundary of two CLI paths: finding upsert (numeric ghCommentId, state-only update) and
// salida propose with a ticket ref.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as FINDING } from "@/app/api/tickets/[id]/findings/route";
import { POST as SALIDA } from "@/app/api/salidas/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
let ref: string;
let id: string;

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  const t = r.tickets.create({ direction: "andres_asks", title: "Revisa PR 5", ownerSession: "lead" });
  ref = t.ref;
  id = t.id;
});

const post = (path: string, body: unknown) =>
  new Request(`http://local${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const finding = (body: unknown) => FINDING(post(`/api/tickets/${ref}/findings`, body), ctx({ id: ref }));
const FULL = { repo: "acme/api", pr: 5, label: "nit", summary: "a\\b \\d+ \"x\"", at: "src/a.ts:1", anchor: "foo", explanation: "why", sha: "abc1234" };

describe("POST /api/tickets/:id/findings", () => {
  it("accepts a numeric ghCommentId and stores it as a string", async () => {
    const res = await finding({ ...FULL, ghCommentId: 3254001122 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { finding: { ghCommentId: unknown; summary: string } }).finding).toMatchObject({ ghCommentId: "3254001122", summary: FULL.summary });
    expect((await finding({ ...FULL, n: 1, ghCommentId: "77" })).status).toBe(200);
    expect(r.reviews.findings(ref)[0]!.ghCommentId).toBe("77");
    expect((await finding({ ...FULL, n: 1, ghCommentId: null })).status).toBe(200);
    expect(r.reviews.findings(ref)[0]!.ghCommentId).toBe("77");
  });

  it("a state-only upsert is 200 and changes only the state", async () => {
    await finding({ ...FULL, ghCommentId: 12 });
    const res = await finding({ repo: "acme/api", pr: 5, n: 1, state: "waived" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { finding: object }).finding).toMatchObject({ n: 1, state: "waived", label: "nit", summary: FULL.summary, at: FULL.at, anchor: "foo", explanation: "why", sha: "abc1234", ghCommentId: "12" });
  });

  it("a new finding without label and summary is a 400 with a message", async () => {
    for (const body of [{ repo: "acme/api", pr: 5, state: "fixed" }, { repo: "acme/api", pr: 5, n: 4, state: "fixed" }]) {
      const res = await finding(body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/label and summary are required/);
    }
  });
});

describe("POST /api/salidas with a ticket", () => {
  const propose = (ticketId?: string) =>
    SALIDA(post("/api/salidas", { source: "slack", destination: { kind: "slack_channel", workspace: "designli", channel: "#pruebas", postAs: "Andrés" }, body: "hola", ticketId }), ctx());

  it("stores the ticket id for a ref and for an id", async () => {
    for (const t of [ref, id]) {
      const res = await propose(t);
      expect(res.status).toBe(201);
      expect(((await res.json()) as { ticketId: string }).ticketId).toBe(id);
    }
  });

  it("an unknown ticket is a 404, not a FOREIGN KEY 500", async () => {
    const res = await propose("t9999");
    expect(res.status).toBe(404);
    expect(r.salidas.list({})).toHaveLength(0);
  });

  it("works without a ticket", async () => {
    expect((await propose()).status).toBe(201);
  });
});

describe("POST /api/salidas with Basecamp mentions", () => {
  const mentions = [{ id: "9001", name: "Matt Myers" }];
  const propose = (kind: string, withMentions = true) =>
    SALIDA(post("/api/salidas", { source: "basecamp", destination: { kind, project: "Scout", postAs: "Andrés", ...(withMentions ? { mentions } : {}) }, body: "hola" }), ctx());

  it("a comment stores its mentions in the destination", async () => {
    const res = await propose("basecamp_comment");
    expect(res.status).toBe(201);
    expect(((await res.json()) as { destination: { mentions: unknown } }).destination.mentions).toEqual(mentions);
  });

  it("a campfire line or a message post with mentions is a 400 and stores nothing", async () => {
    for (const kind of ["basecamp_campfire", "basecamp_message"]) {
      const res = await propose(kind);
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(/mentions are only for a basecamp_comment/);
    }
    expect(r.salidas.list({})).toHaveLength(0);
    expect((await propose("basecamp_campfire", false)).status).toBe(201);
  });
});
