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

describe("POST /api/tickets/:id/plan/approve { revoke }", () => {
  const wakes = () => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === "ticket.plan_approved");

  it("takes a pre-approval back: the step is planned again and the owner wakes with revoked, partial", async () => {
    await approve({ only: [ids[0]] });
    const res = await approve({ revoke: [ids[0]] });
    expect(res.status).toBe(200);
    expect(states()).toEqual(["planned", "planned"]);
    expect(r.tickets.get(ref).status).toBe("waiting_andres");
    expect(wakes().slice(-1)[0]!.payload).toMatchObject({ ref, revoked: [ids[0]], partial: true });
  });

  it("a step Claude already started is refused with 409 and a clear English error", async () => {
    await approve({ only: [ids[0]] });
    r.tickets.setActionState(ids[0]!, "running");
    const res = await approve({ revoke: [ids[0]] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/already started/);
    expect(states()).toEqual(["running", "planned"]);
  });

  it("is refused for a step that is only planned (409), an empty list (400), revoke with only or reject (400)", async () => {
    expect((await approve({ revoke: [ids[0]] })).status).toBe(409);
    expect((await approve({ revoke: [] })).status).toBe(400);
    await approve({ only: [ids[0]] });
    expect((await approve({ revoke: [ids[0]], only: [ids[1]] })).status).toBe(400);
    expect((await approve({ revoke: [ids[0]], reject: [ids[1]] })).status).toBe(400);
    expect(states()).toEqual(["approved", "planned"]);
  });

  it("is refused after the full approval (409) and on a closed ticket (409)", async () => {
    await approve({ only: [ids[0]] });
    await approve({ only: [ids[1]] });
    expect((await approve({ revoke: [ids[0]] })).status).toBe(409);
    expect(states()).toEqual(["approved", "approved"]);
  });

  it("is refused on a closed ticket (409)", async () => {
    await approve({ only: [ids[0]] });
    r.tickets.transition(ref, { type: "close", by: "andres" });
    expect((await approve({ revoke: [ids[0]] })).status).toBe(409);
    expect(states()).toEqual(["approved", "planned"]);
  });
});

describe("PATCH /api/actions/:id (sessions)", () => {
  const patch = (state: string) => PATCH_ACTION(req("PATCH", "/x", { state }), ctx({ id: ids[0]! }));

  it("accepts running, done and failed for an approved step", async () => {
    await approve({ only: [ids[0]] });
    await approve({ only: [ids[1]] });
    expect((await patch("running")).status).toBe(200);
    expect((await patch("done")).status).toBe(200);
    expect((await PATCH_ACTION(req("PATCH", "/x", { state: "failed" }), ctx({ id: ids[1]! }))).status).toBe(200);
    expect(states()).toEqual(["done", "failed"]);
  });

  it("refuses running, done and failed with 409 for a needs_ok step that is not approved", async () => {
    for (const state of ["running", "done", "failed"]) {
      const res = await patch(state);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/not approved/);
    }
    expect(states()).toEqual(["planned", "planned"]);
  });

  it("approve, revoke, then running is a 409 and the step stays planned", async () => {
    await approve({ only: [ids[0]] });
    expect((await approve({ revoke: [ids[0]] })).status).toBe(200);
    expect((await patch("running")).status).toBe(409);
    expect(states()).toEqual(["planned", "planned"]);
  });

  it("repeating the step's current state is a 200 no-op, and an unknown id is 404", async () => {
    await approve({ only: [ids[0]] });
    expect((await patch("done")).status).toBe(200);
    expect((await patch("done")).status).toBe(200);
    expect(states()).toEqual(["done", "planned"]);
    expect((await PATCH_ACTION(req("PATCH", "/x", { state: "running" }), ctx({ id: "pa_nope" }))).status).toBe(404);
  });

  it("skipped marks a step the session will not do: from planned or approved, final, and it never blocks closing", async () => {
    // a planned needs_ok step can be skipped without ever being approved
    expect((await patch("skipped")).status).toBe(200);
    await approve({ only: [ids[1]] });
    expect((await PATCH_ACTION(req("PATCH", "/x", { state: "skipped" }), ctx({ id: ids[1]! }))).status).toBe(200);
    expect(states()).toEqual(["skipped", "skipped"]);
    // repeating it is a no-op; any other state afterwards is a 409
    expect((await patch("skipped")).status).toBe(200);
    for (const state of ["running", "done", "failed"]) {
      const res = await patch(state);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/skipped/);
    }
    expect(states()).toEqual(["skipped", "skipped"]);
    // no step waits for an OK any more, and the ticket closes
    expect(r.tickets.detail(ref).actions.some((a) => a.state === "planned")).toBe(false);
    expect(() => r.tickets.transition(ref, { type: "close", by: "claude" })).not.toThrow();
    expect(r.tickets.get(ref).status).toBe("closed");
  });

  it("a step that is done or rejected cannot be skipped (409); a failed one can", async () => {
    await approve({ only: [ids[0]] });
    await patch("done");
    const res = await patch("skipped");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/only a step that is still open/);
    await approve({ only: [ids[1]] });
    await PATCH_ACTION(req("PATCH", "/x", { state: "failed" }), ctx({ id: ids[1]! }));
    expect((await PATCH_ACTION(req("PATCH", "/x", { state: "skipped" }), ctx({ id: ids[1]! }))).status).toBe(200);
    expect(states()).toEqual(["done", "skipped"]);
    const t = r.tickets.create({ direction: "andres_asks", title: "otro", ownerSession: "lead" });
    const [only] = r.tickets.plan(t.id, [{ kind: "merge_pr", source: "github", label: "Mergear", mode: "needs_ok" }]).actions;
    r.tickets.approvePlan(t.id, [only!.id]); // rejected by Andrés
    expect((await PATCH_ACTION(req("PATCH", "/x", { state: "skipped" }), ctx({ id: only!.id }))).status).toBe(409);
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
