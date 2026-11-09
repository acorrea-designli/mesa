// API tests for plan approval (whole, per step, off-status) and for what a session may report on a step,
// plus Hoy naming the need of the ticket an item hangs on.
import { beforeEach, describe, expect, it } from "vitest";
import { PATCH as PATCH_ACTION } from "@/app/api/actions/[id]/route";
import { POST as APPROVE } from "@/app/api/tickets/[id]/plan/approve/route";
import { loadHoy } from "@/features/hoy/data";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { eventsAfter } from "../wake/wake";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
let ref: string;
let ids: string[];
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" });
  const t = r.tickets.create({ direction: "andres_asks", title: "Mergea y mueve", ownerSession: "lead" });
  ref = t.ref;
  ids = r.tickets
    .plan(t.id, [
      { kind: "merge_pr", source: "github", label: "Mergear", mode: "needs_ok" },
      { kind: "move_card", source: "github", label: "Mover", mode: "needs_ok" },
    ])
    .actions.map((a) => a.id);
});

const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://local${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const approve = (body: unknown) => APPROVE(req("POST", "/x", body), ctx({ id: ref }));
const states = () => r.tickets.detail(ref).actions.map((a) => a.state);

describe("POST /api/tickets/:id/plan/approve { only }", () => {
  it("pre-approves one step: the rest stays planned, the status holds and the wake is partial", async () => {
    const res = await approve({ only: [ids[0]] });
    expect(res.status).toBe(200);
    expect(states()).toEqual(["approved", "planned"]);
    expect(r.tickets.get(ref).status).toBe("waiting_andres");
    const wake = eventsAfter(r.db, "lead", 0).filter((e) => e.kind === "ticket.plan_approved");
    expect(wake.map((e) => e.payload)).toMatchObject([{ ref, approved: [ids[0]], partial: true }]);
  });

  it("approving the last planned step is the full approval", async () => {
    await approve({ only: [ids[0]] });
    expect((await approve({ only: [ids[1]] })).status).toBe(200);
    expect(r.tickets.get(ref).status).toBe("working");
  });

  it("works on a ticket that is no longer waiting_andres", async () => {
    r.tickets.addMessage(ref, { author: "andres", body: "una duda" });
    expect(r.tickets.get(ref).status).toBe("waiting_claude");
    expect((await approve({ only: [ids[1]] })).status).toBe(200);
    expect(states()).toEqual(["planned", "approved"]);
  });

  it("is refused for a step that is not planned (409), an empty list (400), only with reject (400)", async () => {
    await approve({ only: [ids[0]] });
    expect((await approve({ only: [ids[0]] })).status).toBe(409);
    expect((await approve({ only: [] })).status).toBe(400);
    expect((await approve({ only: [ids[1]], reject: [ids[0]] })).status).toBe(400);
    expect(states()).toEqual(["approved", "planned"]);
  });

  it("without only it is the whole plan, from any status, and 409 with nothing planned", async () => {
    r.tickets.addMessage(ref, { author: "andres", body: "una duda" });
    expect((await approve({})).status).toBe(200);
    expect(states()).toEqual(["approved", "approved"]);
    expect((await approve({})).status).toBe(409);
  });
});

describe("PATCH /api/actions/:id (sessions)", () => {
  const patch = (state: string) => PATCH_ACTION(req("PATCH", "/x", { state }), ctx({ id: ids[0]! }));

  it("accepts running, done and failed", async () => {
    for (const state of ["running", "done", "failed"]) {
      expect((await patch(state)).status).toBe(200);
      expect(r.tickets.detail(ref).actions[0]!.state).toBe(state);
    }
  });

  it("refuses approved, rejected and planned with 400: a session cannot approve its own step", async () => {
    for (const state of ["approved", "rejected", "planned", "bogus"]) {
      expect((await patch(state)).status).toBe(400);
    }
    expect(states()).toEqual(["planned", "planned"]);
  });
});

describe("Hoy rows of an item linked to a ticket that needs Andrés", () => {
  const item = (externalId: string, ticketRef?: string) =>
    r.items.upsert({ source: "basecamp", externalId, kind: "request", title: externalId, project: "Acme", meta: ticketRef ? { ticketRef } : {} }).item;

  it("shows the first need in Necesita and the Te espera tag; other rows are unchanged", () => {
    const linked = item("linked", ref);
    const loose = item("loose");
    const rows = loadHoy().rows;
    const row = rows.find((x) => x.id === linked.id)!;
    expect(row.need).toBe("Aprobar plan");
    expect(row.tag).toEqual({ tone: "you", label: "Te espera" });
    const other = rows.find((x) => x.id === loose.id)!;
    expect(other.need).not.toBe("Aprobar plan");
  });

  it("an approved plan, or a closed ticket, leaves the row as it was", () => {
    const linked = item("linked", ref);
    r.tickets.approvePlan(ref);
    const after = loadHoy().rows.find((x) => x.id === linked.id)!;
    expect(after.need).not.toBe("Aprobar plan");
    expect(after.need).toBe("Respuesta"); // the item's own need again
    // the ticket is Claude's turn now: its status tag, not the item's own "Te espera"
    expect(after.tag).toEqual({ tone: "cl", label: "Claude trabaja" });
    expect(after.phoneTag).toEqual({ tone: "cl", label: "Claude trabaja" });
  });
});
