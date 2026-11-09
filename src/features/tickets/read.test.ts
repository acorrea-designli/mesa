import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/sqlite";
import { createRepos, type Repos } from "@/lib/repo";
import { loadTickets, selectionOrder } from "./read";

let r: Repos;
const T0 = new Date("2026-11-03T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const now = at(60_000);

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
});

const claudeAsks = (title: string, when: Date) => r.tickets.create({ direction: "claude_asks", title, body: title, ownerSession: "lead" }, when);

describe("selectionOrder", () => {
  const rows = [{ ref: "t3" }, { ref: "t2" }];
  it("an explicit ?t= is used as is, with no fallback", () => {
    expect(selectionOrder({ selected: "t2", pinned: "t3" }, rows)).toEqual(["t2"]);
    expect(selectionOrder({ selected: "t9" }, rows)).toEqual(["t9"]);
  });
  it("the landing view (nothing open yet) defaults to the first row", () => {
    expect(selectionOrder({}, rows)).toEqual(["t3"]);
    expect(selectionOrder({}, [])).toEqual([]);
  });
  it("a pinned ticket beats the first row and falls back to it when gone", () => {
    expect(selectionOrder({ pinned: "t2" }, rows)).toEqual(["t2", "t3"]);
  });
  it("the new-request view selects nothing", () => {
    expect(selectionOrder({ creating: true, pinned: "t2" }, rows)).toEqual([]);
  });
});

describe("loadTickets selection", () => {
  it("a new ticket arriving never moves the open one (pinned or ?t=)", () => {
    const a = claudeAsks("A", at(1000));
    const landing = loadTickets(r, {}, now);
    expect(landing.selected?.ticket.ref).toBe(a.ref); // landing: first row
    const b = claudeAsks("B", at(2000));
    expect(loadTickets(r, {}, now).selected?.ticket.ref).toBe(a.ref); // landing: the first row is the one waiting longest
    expect(loadTickets(r, { pinned: a.ref }, now).selected?.ticket.ref).toBe(a.ref);
    expect(loadTickets(r, { selected: a.ref }, now).selected?.ticket.ref).toBe(a.ref);
    expect(loadTickets(r, { pinned: a.ref }, now).rows.map((x) => x.ref)).toContain(b.ref); // the list still shows the new one
  });

  it("a message arriving on another ticket does not move the open one", () => {
    const a = claudeAsks("A", at(1000));
    const b = claudeAsks("B", at(2000));
    r.tickets.addMessage(b.id, { author: "claude", body: "ping" }, at(3000));
    expect(loadTickets(r, { pinned: a.ref }, now).selected?.ticket.ref).toBe(a.ref);
  });

  it("a pin that no longer exists falls back to the first row; a bad ?t= shows no thread", () => {
    const a = claudeAsks("A", at(1000));
    expect(loadTickets(r, { pinned: "t999" }, now).selected?.ticket.ref).toBe(a.ref);
    expect(loadTickets(r, { selected: "t999" }, now).selected).toBeNull();
  });

  it("the new-request view has no selected ticket", () => {
    claudeAsks("A", at(1000));
    expect(loadTickets(r, { creating: true }, now).selected).toBeNull();
  });
});

describe("loadTickets verbs", () => {
  const plan = (kinds: [string, string][]) => {
    const t = claudeAsks("Pedido", at(1000));
    r.tickets.plan(t.id, kinds.map(([kind, label]) => ({ kind, source: "claude" as const, label, mode: "direct" as const })), "lead");
  };

  it("an unknown kind adds no verb, and never a plan-step label", () => {
    plan([["weird_kind", "Hacer algo muy largo y específico · con detalle"]]);
    const v = loadTickets(r, { creating: true }, now).verbs;
    expect(v).toEqual(["Cancelar salida", "Mover en el tablero", "Crear tarea", "Revisar PR", "Investigar"]);
    expect(v.join("|")).not.toContain("Hacer algo");
  });

  it("known kinds map to their short verb, most used first, padded with the defaults, at most 5", () => {
    plan([["branch_pr", "dev-t15 en worktree desde main local, con una frase larguísima"], ["merge_pr", "Merge a main"], ["branch_pr", "otro"]]);
    expect(loadTickets(r, { creating: true }, now).verbs).toEqual(["Abrir PR", "Mergear PR", "Cancelar salida", "Mover en el tablero", "Crear tarea"]);
  });

  it("the catalogue kinds have short Spanish verbs", () => {
    const kinds = ["branch_pr", "merge_pr", "send_message", "cancel_message", "apply_infra", "post_github"];
    plan(kinds.map((k) => [k, k] as [string, string]));
    const learned = loadTickets(r, { creating: true }, now).verbs;
    expect(learned).toEqual(["Abrir PR", "Mergear PR", "Enviar mensaje", "Cancelar mensaje", "Aplicar infra"]);
    expect(Math.max(...learned.map((v) => v.length))).toBeLessThanOrEqual(20);
  });
});

describe("loadTickets projects", () => {
  const item = (source: "slack" | "github" | "basecamp", externalId: string, project: string) =>
    r.items.upsert({ source, externalId, kind: "message", title: externalId, project }, T0).item;

  it("leaves out the project of a Slack item (a person from a DM, a channel) and of a ticket made from it", () => {
    const dm = item("slack", "dm1", "Christian Ruiz");
    item("slack", "ch1", "scout-dev");
    r.tickets.create({ direction: "andres_asks", title: "De un DM", project: "Christian Ruiz", itemId: dm.id }, at(1000));
    r.tickets.create({ direction: "andres_asks", title: "Otro", project: "scout-dev" }, at(2000));
    expect(loadTickets(r, { creating: true }, now).projects).toEqual([]);
  });

  it("keeps ticket, GitHub and Basecamp projects, sorted and deduplicated", () => {
    item("slack", "dm1", "Christian Ruiz");
    item("github", "pr1", "scout-api");
    item("github", "pr2", "scout-api");
    item("basecamp", "bc1", "Acme");
    r.tickets.create({ direction: "andres_asks", title: "T", project: "mesa" }, at(1000));
    r.tickets.create({ direction: "andres_asks", title: "U", project: "Christian Ruiz", itemId: r.items.list().find((i) => i.externalId === "dm1")!.id }, at(2000));
    expect(loadTickets(r, { creating: true }, now).projects).toEqual(["Acme", "mesa", "scout-api"]);
  });
});

describe("loadTickets read state", () => {
  it("flags the tickets with a message he has not seen, and the selected one", () => {
    const a = claudeAsks("A", at(1000));
    const b = claudeAsks("B", at(2000));
    r.tickets.markSeen(a.id, at(3000));
    const d = loadTickets(r, { pinned: a.ref }, now);
    expect(Object.fromEntries(d.rows.map((x) => [x.ref, x.unread]))).toEqual({ [a.ref]: false, [b.ref]: true });
    expect(d.selectedUnread).toBe(false);
    expect(loadTickets(r, { selected: b.ref }, now).selectedUnread).toBe(true);
  });

  it("opening marks it seen, and a later message from Claude flags it again", () => {
    const a = claudeAsks("A", at(1000));
    expect(loadTickets(r, { selected: a.ref }, now).selectedUnread).toBe(true);
    r.tickets.markSeen(a.ref, at(2000));
    expect(loadTickets(r, { selected: a.ref }, now).rows[0]?.unread).toBe(false);
    r.tickets.addMessage(a.id, { author: "claude", body: "otra cosa" }, at(3000));
    const d = loadTickets(r, { selected: a.ref }, now);
    expect(d.rows[0]?.unread).toBe(true);
    expect(d.selectedUnread).toBe(true);
  });

  it("his own reply never flags the ticket", () => {
    const a = claudeAsks("A", at(1000));
    r.tickets.markSeen(a.ref, at(2000));
    r.tickets.addMessage(a.id, { author: "andres", body: "A" }, at(3000));
    expect(loadTickets(r, { selected: a.ref }, now).rows.find((x) => x.ref === a.ref)?.unread).toBe(false);
  });
});

describe("loadTickets needs", () => {
  const needsOk = [{ kind: "merge_pr", source: "github" as const, label: "Mergear", mode: "needs_ok" as const }];
  const request = (title: string, when: Date) => r.tickets.create({ direction: "andres_asks", title, ownerSession: "lead" }, when);

  it("a plan still waiting for his OK marks the row after the status drifted off waiting_andres", () => {
    const t = request("Plan", at(1000));
    r.tickets.plan(t.id, needsOk, "lead");
    r.tickets.addMessage(t.id, { author: "andres", body: "una duda" }, at(2000)); // waiting_claude
    const d = loadTickets(r, {}, now);
    const row = d.rows.find((x) => x.id === t.id)!;
    expect(row.status).toBe("waiting_claude");
    expect(row.needs.map((n) => n.label)).toEqual(["Aprobar plan"]);
    expect(row.excerpt).toBe("Aprobar plan · 1 paso te pide OK");
    expect(d.counts.you).toBe(1);
  });

  it("sorts rows with needs first by need priority then oldest first, then the rest newest first", () => {
    const plain = request("Sin nada", at(5000));
    const salida = request("Salida", at(1000));
    r.salidas.create({ source: "slack", destination: { kind: "slack_channel", workspace: "w", channel: "#a", postAs: "Andrés" }, title: "Hola", body: "Hola", ticketId: salida.id }, at(1500));
    const planNew = request("Plan nuevo", at(3000));
    r.tickets.plan(planNew.id, needsOk, "lead");
    const planOld = request("Plan viejo", at(2000));
    r.tickets.plan(planOld.id, needsOk, "lead");
    const rows = loadTickets(r, {}, now).rows;
    expect(rows.map((x) => x.ref)).toEqual([planOld.ref, planNew.ref, salida.ref, plain.ref]);
  });

  it("the Te esperan tab lists and counts only tickets with a need", () => {
    const withNeed = request("Con plan", at(1000));
    r.tickets.plan(withNeed.id, needsOk, "lead");
    request("Sin nada", at(2000));
    const d = loadTickets(r, { tab: "you" }, now);
    expect(d.rows.map((x) => x.ref)).toEqual([withNeed.ref]);
    expect(d.counts).toMatchObject({ open: 2, you: 1 });
  });
});
