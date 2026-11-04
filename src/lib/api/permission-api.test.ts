// API tests for "Pídeme permiso", /api/lead/focus and who may decide an approval, with the
// route handlers over an in-memory database; plus Hoy, Permisos for an approval with no ticket.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as APPROVE } from "@/app/api/approvals/[id]/approve/route";
import { GET as GET_APPROVAL } from "@/app/api/approvals/[id]/route";
import { POST as POST_APPROVALS } from "@/app/api/approvals/route";
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

describe("only Andrés decides", () => {
  it("has no raw decision route: nothing outside the three UI routes can decide an approval", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/app/api/approvals/[id]/decision"))).toBe(false);
  });

  it("the UI routes decide as andres, whatever the body says", async () => {
    const [a, b, c, d] = [pending(), pending(), pending(), pending()];
    expect((await APPROVE(req("POST", "/x", {}), ctx({ id: a!.id }))).status).toBe(200);
    expect((await READ_CONFIG(req("POST", "/x", {}), ctx({ id: b!.id }))).status).toBe(200);
    expect((await DENY(req("POST", "/x", { note: "no" }), ctx({ id: c!.id }))).status).toBe(200);
    await APPROVE(req("POST", "/x", { actor: "someone-else", decision: "deny" }), ctx({ id: d!.id }));
    expect([a!, b!, c!, d!].map((x) => r.approvals.get(x.id)).map((x) => [x.decision, x.decidedBy])).toEqual([
      ["allow", "andres"],
      ["read_config", "andres"],
      ["deny", "andres"],
      ["allow", "andres"],
    ]);
  });
});

// The hook against the real routes and repositories: it files the card and honours only Andrés's decision.
describe("the approval hook end to end", () => {
  const HOOK = path.join(process.cwd(), "scripts/hooks/mesa-approval.mjs");
  const dispatch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    const rq = new Request(u, init);
    const m = /^\/api\/approvals\/([^/]+)$/.exec(u.pathname);
    if (u.pathname === "/api/approvals") return POST_APPROVALS(rq, ctx());
    if (m) return GET_APPROVAL(rq, ctx({ id: m[1]! }));
    throw new TypeError("fetch failed");
  };
  const agent = { tool_name: "Bash", tool_input: { command: "aws s3 cp a b" }, cwd: "x", agent_id: "a1", transcript_path: "t.jsonl", session_id: "s" };
  const run = async (decide: (id: string) => Promise<unknown> | unknown) => {
    const { approve } = (await import(/* @vite-ignore */ pathToFileURL(HOOK).href)) as { approve: (i: unknown, o: unknown) => Promise<{ hookSpecificOutput: { decision: { behavior: string; message?: string } } }> };
    const filed = approve(agent, { fetchImpl: dispatch, timeoutMs: 3000, pollMs: 20, waitSec: 1, rules: [], env: { MESA_AGENT: `dev-${ref}` } });
    for (let i = 0; i < 100 && !r.approvals.list({ status: "pending" }).length; i++) await new Promise((ok) => setTimeout(ok, 20));
    await decide(r.approvals.list({ status: "pending" })[0]!.id);
    return (await filed).hookSpecificOutput.decision;
  };

  it("allows after Andrés presses Dar permiso", async () => {
    const d = await run((id) => APPROVE(req("POST", "/x", {}), ctx({ id })));
    expect(d.behavior).toBe("allow");
  });

  it("ignores a decision made by anyone else, even an allow", async () => {
    const d = await run((id) => r.approvals.decide(id, { decision: "allow", actor: "dev-t12" }));
    expect(d.behavior).toBe("deny");
    expect(d.message).toMatch(/not by Andrés/);
  });
});

describe("/api/lead/focus", () => {
  it("sets, reads and clears; refuses unknown (404) and closed (409) tickets", async () => {
    expect(await (await FOCUS_GET(req("GET", "/x"), ctx())).json()).toEqual({ ticketRef: null, expiresAt: null });
    expect((await FOCUS_SET(req("PUT", "/x", { ticket: ref }), ctx())).status).toBe(200);
    expect(await (await FOCUS_GET(req("GET", "/x"), ctx())).json()).toEqual({ ticketRef: ref, expiresAt: expect.any(String) });
    expect(await (await FOCUS_CLEAR(req("DELETE", "/x"), ctx())).json()).toEqual({ ticketRef: null, expiresAt: null });
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

describe("Hoy, Permisos shows the lead focus", () => {
  it("names the ticket and when it lapses, and drops it once cleared", () => {
    expect(loadHoy().leadFocus).toBeNull();
    r.focus.set(ref);
    expect(loadHoy().leadFocus).toMatchObject({ ticketRef: ref, title: "Sube el reporte", until: expect.stringMatching(/^\d\d:\d\d$/) });
    r.focus.clear();
    expect(loadHoy().leadFocus).toBeNull();
  });
});
