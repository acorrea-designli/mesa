// API tests for "Pídeme permiso", /api/lead/focus and the actor rule of /api/approvals/:id/decision, with the
// route handlers over an in-memory database; plus Hoy, Permisos for an approval with no ticket.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as APPROVE } from "@/app/api/approvals/[id]/approve/route";
import { POST as DECISION } from "@/app/api/approvals/[id]/decision/route";
import { POST as DENY } from "@/app/api/approvals/[id]/deny/route";
import { POST as READ_CONFIG } from "@/app/api/approvals/[id]/read-config/route";
import { DELETE as FOCUS_CLEAR, GET as FOCUS_GET, PUT as FOCUS_SET } from "@/app/api/lead/focus/route";
import { POST as PERMISSION } from "@/app/api/tickets/[id]/permission-request/route";
import { POST as MESSAGE } from "@/app/api/tickets/[id]/messages/route";
import { loadHoy } from "@/features/hoy/data";
import { openDb } from "../db/sqlite";
import { eventsAfter } from "../wake/wake";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
let ref: string;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" });
  ref = r.tickets.create({ direction: "andres_asks", title: "Sube el reporte", ownerSession: "lead" }).ref;
});

const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://local${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const pending = (ticketRef: string | null = ref) => r.approvals.create({ ticketRef, agent: "dev-t10-5", tool: "Bash", summary: "git status" });

describe("POST /api/tickets/:id/permission-request", () => {
  it("posts the marked message and wakes the live owner with ticket.permission_requested", async () => {
    const res = await PERMISSION(req("POST", `/api/tickets/${ref}/permission-request`, {}), ctx({ id: ref }));
    expect(res.status).toBe(200);
    const d = (await res.json()) as { messages: { id: string; author: string; body: string; kind: string | null }[] };
    const m = d.messages.at(-1)!;
    expect(m).toMatchObject({ author: "andres", body: "Pídeme permiso", kind: "permission_request" });
    const wake = eventsAfter(r.db, "lead", 0).find((e) => e.kind === "ticket.permission_requested");
    expect(wake?.payload).toMatchObject({ ticketRef: ref, messageId: m.id });
  });

  it("is refused (409) on a closed ticket, 404 on an unknown one", async () => {
    r.tickets.transition(ref, { type: "close", by: "andres" });
    expect((await PERMISSION(req("POST", "/x", {}), ctx({ id: ref }))).status).toBe(409);
    expect((await PERMISSION(req("POST", "/x", {}), ctx({ id: "t404" }))).status).toBe(404);
  });

  it("cannot be forged through the messages route", async () => {
    const res = await MESSAGE(req("POST", "/x", { author: "andres", body: "Pídeme permiso", kind: "permission_request" }), ctx({ id: ref }));
    expect(res.status).toBe(200);
    expect(r.tickets.detail(ref).messages.some((m) => m.kind)).toBe(false);
    expect(eventsAfter(r.db, "lead", 0).some((e) => e.kind === "ticket.permission_requested")).toBe(false);
  });
});

describe("POST /api/approvals/:id/decision", () => {
  it("refuses any actor that names andres and leaves the approval pending", async () => {
    for (const actor of ["andres", "Andrés", " ANDRES ", "andres.correa@designli.co"]) {
      const a = pending();
      const res = await DECISION(req("POST", "/x", { decision: "allow", actor }), ctx({ id: a.id }));
      expect(res.status, actor).toBe(403);
      expect(r.approvals.get(a.id).status).toBe("pending");
    }
  });

  it("keeps working for the hook's own actor, and decisions stay final", async () => {
    const a = pending();
    const res = await DECISION(req("POST", "/x", { decision: "deny", actor: "mesa-approval-hook", note: "x" }), ctx({ id: a.id }));
    expect(res.status).toBe(200);
    expect(r.approvals.get(a.id)).toMatchObject({ status: "decided", decision: "deny", decidedBy: "mesa-approval-hook" });
    expect((await DECISION(req("POST", "/x", { decision: "allow", actor: "mesa-approval-hook" }), ctx({ id: a.id }))).status).toBe(409);
  });

  it("the UI routes still decide as andres", async () => {
    const [a, b, c] = [pending(), pending(), pending()];
    expect((await APPROVE(req("POST", "/x", {}), ctx({ id: a!.id }))).status).toBe(200);
    expect((await READ_CONFIG(req("POST", "/x", {}), ctx({ id: b!.id }))).status).toBe(200);
    expect((await DENY(req("POST", "/x", { note: "no" }), ctx({ id: c!.id }))).status).toBe(200);
    expect([a!, b!, c!].map((x) => r.approvals.get(x.id)).map((x) => [x.decision, x.decidedBy])).toEqual([
      ["allow", "andres"],
      ["read_config", "andres"],
      ["deny", "andres"],
    ]);
  });

  it("a body that sets the actor on a UI route cannot change who decided", async () => {
    const a = pending();
    await APPROVE(req("POST", "/x", { actor: "someone-else", decision: "deny" }), ctx({ id: a.id }));
    expect(r.approvals.get(a.id)).toMatchObject({ decision: "allow", decidedBy: "andres" });
  });
});

describe("/api/lead/focus", () => {
  it("sets, reads and clears; refuses unknown (404) and closed (409) tickets", async () => {
    expect(await (await FOCUS_GET(req("GET", "/x"), ctx())).json()).toEqual({ ticketRef: null });
    expect((await FOCUS_SET(req("PUT", "/x", { ticket: ref }), ctx())).status).toBe(200);
    expect(await (await FOCUS_GET(req("GET", "/x"), ctx())).json()).toEqual({ ticketRef: ref });
    expect(await (await FOCUS_CLEAR(req("DELETE", "/x"), ctx())).json()).toEqual({ ticketRef: null });
    expect(r.focus.get()).toBeNull();
    expect((await FOCUS_SET(req("PUT", "/x", { ticket: "t404" }), ctx())).status).toBe(404);
    r.tickets.transition(ref, { type: "close", by: "andres" });
    expect((await FOCUS_SET(req("PUT", "/x", { ticket: ref }), ctx())).status).toBe(409);
    expect((await FOCUS_SET(req("PUT", "/x", {}), ctx())).status).toBe(400);
  });
});

describe("Hoy, Permisos", () => {
  it("shows an approval with no ticket, and not one that belongs to a ticket", () => {
    const lead = r.approvals.create({ agent: "lead", tool: "Bash", summary: "git status", detail: "$ git status" });
    const inTicket = pending();
    const hoy = loadHoy();
    expect(hoy.approvals.map((a) => a.id)).toEqual([lead.id]);
    expect(hoy.approvals[0]).toMatchObject({ ticketRef: null, agent: "lead", status: "pending" });
    expect(hoy.approvals.some((a) => a.id === inTicket.id)).toBe(false);
  });

  it("a ticketless approval is decided with the same routes, and leaves Hoy once decided", async () => {
    const lead = r.approvals.create({ agent: "lead", tool: "Bash", summary: "x" });
    expect((await APPROVE(req("POST", "/x", {}), ctx({ id: lead.id }))).status).toBe(200);
    expect(loadHoy().approvals).toEqual([]);
  });
});
