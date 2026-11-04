// API tests for batch moves (POST /api/tasks/batch), "Dárselo a Claude" (POST /api/tasks/:id/dispatch),
// task creation with and without "Solo anotar", Nuevo pedido, and the GitHub Project push of a
// batch move with gh mocked. Route handlers run over an in-memory database.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as BATCH } from "@/app/api/tasks/batch/route";
import { POST as DISPATCH } from "@/app/api/tasks/[id]/dispatch/route";
import { POST as CREATE_TASK } from "@/app/api/tasks/route";
import { POST as CREATE_TICKET } from "@/app/api/tickets/route";
import { openDb } from "../db/sqlite";
import { pushPending, type ProjectSettings } from "../integrations/github-project";
import { fakeGh, ok } from "../integrations/test/fake-gh";
import { subscribeChanges, type LiveChange } from "../live/bus";
import { createRepos, type Repos } from "../repo";
import { lastInteractionAt } from "../repo/interaction";
import { eventsAfter } from "../wake/wake";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
});

const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://local${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const batch = (b: unknown) => BATCH(req("POST", "/api/tasks/batch", b), ctx());
const created = () => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === "ticket.created");

describe("POST /api/tasks/batch move", () => {
  it("moves every card in one transaction, stamps lastInteractionAt, publishes once, and Deshacer restores each station", async () => {
    const a = r.tasks.create({ title: "A", source: "github", station: "inbox" });
    const b = r.tasks.create({ title: "B", source: "slack", station: "waiting" });
    r.tasks.markSync(a.id, { syncState: "synced", ghItemId: "PVTI_a" });
    const seen: LiveChange[] = [];
    const off = subscribeChanges((c) => seen.push(c));

    const res = await batch({ action: "move", ids: [a.id, b.id], station: "doing" });
    off();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: { id: string; station: string; syncState: string }[]; previous: { id: string; station: string }[] };
    expect(body.tasks.map((t) => [t.station, t.syncState])).toEqual([
      ["doing", "pending"],
      ["doing", "pending"],
    ]);
    expect(body.previous).toEqual([
      { id: a.id, station: "inbox" },
      { id: b.id, station: "waiting" },
    ]);
    expect(lastInteractionAt(r.db)).not.toBeNull();
    expect(seen.filter((c) => c.entityType === "task")).toHaveLength(1);

    const undo = await batch({ action: "restore", moves: body.previous });
    expect(undo.status).toBe(200);
    expect(r.tasks.get(a.id).station).toBe("inbox");
    expect(r.tasks.get(b.id).station).toBe("waiting");
  });

  it("rolls the whole batch back when one id is unknown", async () => {
    const a = r.tasks.create({ title: "A", source: "github", station: "inbox" });
    const res = await batch({ action: "move", ids: [a.id, "ta_missing"], station: "done" });
    expect(res.status).toBe(404);
    expect(r.tasks.get(a.id).station).toBe("inbox");
  });

  it("linked items follow the card; a card already there keeps its sync state", async () => {
    const { item } = r.items.upsert({ source: "github", externalId: "pr:acme/api#7", kind: "pr_review", title: "api#7" });
    const a = r.tasks.create({ title: "A", source: "github", station: "todo", itemIds: [item.id] });
    const b = r.tasks.create({ title: "B", source: "claude", station: "todo" });
    r.tasks.markSync(b.id, { syncState: "synced" });
    await batch({ action: "move", ids: [a.id, b.id], station: "todo" });
    expect(r.tasks.get(b.id).syncState).toBe("synced");
    await batch({ action: "move", ids: [a.id], station: "waiting" });
    expect(r.items.get(item.id).station).toBe("waiting");
  });

  it("validates the body", async () => {
    expect((await batch({ action: "move", ids: [], station: "doing" })).status).toBe(400);
    expect((await batch({ action: "move", ids: ["x"], station: "nowhere" })).status).toBe(400);
    expect((await batch({ action: "teleport", ids: ["x"] })).status).toBe(400);
  });
});

describe("GitHub Project sync of a batch move (gh mocked)", () => {
  const P: ProjectSettings = {
    id: "PVT_1",
    number: 3,
    url: "https://github.com/users/acorrea-designli/projects/3",
    owner: "acorrea-designli",
    statusFieldId: "F1",
    statusOptions: { Inbox: "o1", Todo: "o2", "In Progress": "o3", Waiting: "o4", Done: "o5" },
  };

  it("pushes each moved card on its own; a failed write flags only that card", async () => {
    const ids = ["A", "B", "C"].map((t) => r.tasks.create({ title: t, source: "claude", station: "inbox" }).id);
    for (const [i, id] of ids.entries()) r.tasks.markSync(id, { syncState: "synced", ghItemId: `PVTI_${i}` });
    await batch({ action: "move", ids, station: "todo" });
    expect(ids.map((id) => r.tasks.get(id).syncState)).toEqual(["pending", "pending", "pending"]);

    const gh = fakeGh((a) => {
      if (a[0] !== "project" || a[1] !== "item-edit") return undefined;
      return a.includes("PVTI_1") ? { code: 1, stdout: "", stderr: "GraphQL: Could not resolve to a node" } : ok({});
    });
    const res = await pushPending(r, gh.run, P);
    expect(res).toMatchObject({ pushed: 2, failed: 1 });
    expect(ids.map((id) => r.tasks.get(id).syncState)).toEqual(["synced", "error", "synced"]);
    expect(gh.calls.filter((c) => c.args[1] === "item-edit").every((c) => c.args.includes("o2"))).toBe(true);
  });
});

describe("Dárselo a Claude", () => {
  it("creates the linked ticket both ways and wakes the lead once with { ticketRef, taskId, kind }", async () => {
    const { item } = r.items.upsert({ source: "github", externalId: "pr:acme/api#7", kind: "pr_review", title: "api#7", url: "https://github.com/acme/api/pull/7", project: "acme/api" });
    const t = r.tasks.create({ title: "Revisar api#7", source: "github", itemIds: [item.id] });

    const res = await DISPATCH(req("POST", `/api/tasks/${t.id}/dispatch`, {}), ctx({ id: t.id }));
    expect(res.status).toBe(200);
    const d = (await res.json()) as { task: { ticketId: string; waitOn: string; owner: { ticketRef: string; agent: null } }; ticket: { id: string; ref: string }; created: boolean };
    expect(d.created).toBe(true);
    expect(d.task.ticketId).toBe(d.ticket.id);
    expect(d.task.waitOn).toBe("claude");
    expect(d.task.owner).toMatchObject({ ticketRef: d.ticket.ref, agent: null, ticketStatus: "waiting_claude" });
    const tk = r.tickets.detail(d.ticket.ref);
    expect(tk).toMatchObject({ direction: "andres_asks", taskId: t.id, itemId: item.id, ownerSession: "lead", project: "acme/api" });
    expect(tk.refs.map((x) => x.target)).toContain("https://github.com/acme/api/pull/7");

    // Idempotent: a second press returns the same ticket and wakes nobody again.
    const again = (await (await DISPATCH(req("POST", `/api/tasks/${t.id}/dispatch`, {}), ctx({ id: t.id }))).json()) as { ticket: { ref: string }; created: boolean };
    expect(again).toMatchObject({ created: false, ticket: { ref: d.ticket.ref } });
    const evs = created();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ sessionId: "lead", entityId: d.ticket.id, payload: { ticketRef: d.ticket.ref, taskId: t.id, kind: "review" } });
  });

  it("refuses sample cards and sends nothing outward", async () => {
    const s = r.tasks.create({ title: "Muestra", source: "slack", isSample: true });
    const res = await DISPATCH(req("POST", `/api/tasks/${s.id}/dispatch`, {}), ctx({ id: s.id }));
    expect(res.status).toBe(409);
    expect(r.tickets.list()).toHaveLength(0);
    expect(r.salidas.list()).toHaveLength(0);
    expect(created()).toHaveLength(0);
  });

  it("batch dispatch skips samples, is idempotent per card and wakes once per new ticket", async () => {
    const a = r.tasks.create({ title: "A", source: "basecamp" });
    const b = r.tasks.create({ title: "B", source: "slack" });
    const s = r.tasks.create({ title: "S", source: "slack", isSample: true });
    await DISPATCH(req("POST", `/api/tasks/${a.id}/dispatch`, { kind: "reply" }), ctx({ id: a.id }));

    const res = await batch({ action: "dispatch", ids: [a.id, b.id, s.id, b.id] });
    const body = (await res.json()) as { results: { task: { id: string }; created: boolean }[]; skipped: { id: string; reason: string }[] };
    expect(body.results.map((x) => [x.task.id, x.created])).toEqual([
      [a.id, false],
      [b.id, true],
    ]);
    expect(body.skipped).toEqual([{ id: s.id, reason: "sample" }]);
    expect(created().map((e) => e.payload.taskId)).toEqual([a.id, b.id]);
    expect(created()[0]!.payload.kind).toBe("reply");
    expect(r.salidas.list()).toHaveLength(0);
  });

  it("a card whose ticket was closed gets a new ticket", async () => {
    const a = r.tasks.create({ title: "A", source: "claude" });
    const first = r.dispatch.dispatch(a.id);
    r.tickets.transition(first.ticket.id, { type: "close", by: "andres" });
    const second = r.dispatch.dispatch(a.id);
    expect(second.created).toBe(true);
    expect(second.ticket.ref).not.toBe(first.ticket.ref);
  });

  it("shows the live owner agent once the lead claims the ticket and spawns it", async () => {
    const a = r.tasks.create({ title: "A", source: "claude" });
    const { ticket } = r.dispatch.dispatch(a.id);
    r.tickets.transition(ticket.ref, { type: "claim" }, "lead");
    r.agents.addAgent({ ticket: ticket.ref, name: `tl-${ticket.ref}`, role: "tl", owner: true });
    expect(r.tasks.get(a.id).owner).toMatchObject({ agent: `tl-${ticket.ref}`, role: "tl", ticketStatus: "working" });
    r.agents.retireAgent(`tl-${ticket.ref}`);
    expect(r.tasks.get(a.id).owner).toMatchObject({ agent: null });
  });
});

describe("creating a task", () => {
  const create = (b: unknown) => CREATE_TASK(req("POST", "/api/tasks", b), ctx());

  it("+ Tarea hands the card to Claude by default", async () => {
    const res = await create({ title: "Revisar backups de Freightmate", source: "claude", project: "freightmate" });
    expect(res.status).toBe(201);
    const t = (await res.json()) as { id: string; ticketId: string; ticket: { ref: string } };
    expect(t.ticket.ref).toMatch(/^t\d+$/);
    expect(r.tickets.get(t.ticket.ref).taskId).toBe(t.id);
    expect(created()).toHaveLength(1);
  });

  it("Solo anotar (sin agente) creates only the card", async () => {
    const t = (await (await create({ title: "Nota", source: "claude", noteOnly: true })).json()) as { ticketId: string | null; ticket: null };
    expect(t).toMatchObject({ ticketId: null, ticket: null });
    expect(r.tickets.list()).toHaveLength(0);
    expect(created()).toHaveLength(0);
  });

  it("cards made from ingested items and sample cards never auto-dispatch", async () => {
    const { item } = r.items.upsert({ source: "slack", externalId: "C1:1.1", kind: "slack_reply", title: "¿Puedes revisar?" });
    await create({ title: "¿Puedes revisar?", source: "slack", itemIds: [item.id] });
    await create({ title: "Muestra", source: "claude", isSample: true });
    expect(r.tickets.list()).toHaveLength(0);
    expect(created()).toHaveLength(0);
  });

  it("Nuevo pedido creates the ticket and its card on the Claude lane, linked both ways", async () => {
    const res = await CREATE_TICKET(req("POST", "/api/tickets", { direction: "andres_asks", title: "Investiga el build", body: "Investiga el build\nFalla desde ayer", project: "scout" }), ctx());
    expect(res.status).toBe(201);
    const tk = (await res.json()) as { id: string; ref: string; taskId: string };
    const task = r.tasks.get(tk.taskId);
    expect(task).toMatchObject({ source: "claude", ticketId: tk.id, title: "Investiga el build", excerpt: "Falla desde ayer", project: "scout" });
    expect(created()).toEqual([expect.objectContaining({ sessionId: "lead", payload: expect.objectContaining({ ticketRef: tk.ref, taskId: task.id }) })]);
  });

  it("Claude's own questions (claude_asks) get no card", async () => {
    await CREATE_TICKET(req("POST", "/api/tickets", { direction: "claude_asks", title: "¿A o B?", ownerSession: "lead" }), ctx());
    expect(r.tasks.list()).toHaveLength(0);
  });
});
