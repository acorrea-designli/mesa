import { describe, expect, it } from "vitest";
import { needLine, needRank, ticketNeeds, type TicketNeedsInput } from "./ticket-needs";

const NOW = new Date("2026-11-09T12:00:00.000Z");
const later = "2026-11-09T13:00:00.000Z";
const earlier = "2026-11-09T11:00:00.000Z";

const msg = (id: string, author: "claude" | "andres", extra: Partial<TicketNeedsInput["messages"][number]> = {}) => ({
  id,
  author,
  body: id,
  options: null,
  recommended: null,
  chosen: null,
  ...extra,
});
const AB = [
  { key: "A", label: "Sí" },
  { key: "B", label: "No" },
];
const input = (o: Partial<TicketNeedsInput> = {}): TicketNeedsInput => ({ status: "working", messages: [], actions: [], approvals: [], reviews: [], salidas: [], ...o });
const kinds = (o: Partial<TicketNeedsInput>) => ticketNeeds(input(o), NOW).map((n) => n.kind);

describe("ticketNeeds", () => {
  it("a closed ticket needs nothing, whatever it holds", () => {
    expect(
      kinds({
        status: "closed",
        actions: [{ state: "planned", mode: "needs_ok" }],
        approvals: [{ status: "pending", agent: "dev", expiresAt: later }],
        salidas: [{ status: "pending", title: "x" }],
      }),
    ).toEqual([]);
  });

  it("a plan with planned needs_ok steps is Aprobar plan, whatever the stored status", () => {
    const actions = [
      { state: "planned", mode: "needs_ok" },
      { state: "planned", mode: "needs_ok" },
      { state: "approved", mode: "needs_ok" },
      { state: "approved", mode: "direct" },
    ] as const;
    for (const status of ["waiting_andres", "waiting_claude", "working"] as const) {
      expect(ticketNeeds(input({ status, actions: [...actions] }), NOW)).toEqual([{ kind: "plan", label: "Aprobar plan", detail: "2 pasos te piden OK" }]);
    }
    expect(ticketNeeds(input({ actions: [{ state: "planned", mode: "needs_ok" }] }), NOW)[0]?.detail).toBe("1 paso te pide OK");
  });

  it("an approved or direct step is not a need", () => {
    expect(kinds({ actions: [{ state: "approved", mode: "needs_ok" }, { state: "planned", mode: "direct" }] })).toEqual([]);
  });

  it("Dar permiso counts pending, unexpired approvals only and names the agent", () => {
    expect(ticketNeeds(input({ approvals: [{ status: "pending", agent: "dev-t29", expiresAt: later }] }), NOW)).toEqual([{ kind: "permission", label: "Dar permiso", detail: "dev-t29" }]);
    expect(kinds({ approvals: [{ status: "decided", agent: "a", expiresAt: later }] })).toEqual([]);
    expect(kinds({ approvals: [{ status: "expired", agent: "a", expiresAt: later }] })).toEqual([]);
    expect(kinds({ approvals: [{ status: "pending", agent: "a", expiresAt: earlier }] })).toEqual([]);
    expect(ticketNeeds(input({ approvals: [{ status: "pending", agent: "a", expiresAt: later }, { status: "pending", agent: "b", expiresAt: later }] }), NOW)[0]?.detail).toBe("a y 1 más");
  });

  it("Firmar salida counts pending salidas and names the title", () => {
    expect(ticketNeeds(input({ salidas: [{ status: "pending", title: "Respuesta a Matt" }, { status: "sent", title: "x" }] }), NOW)).toEqual([
      { kind: "salida", label: "Firmar salida", detail: "Respuesta a Matt" },
    ]);
    expect(kinds({ salidas: [{ status: "draft", title: "x" }] })).toEqual([]);
  });

  it("Responder: the latest Claude options message with no Andrés message after it, from any status", () => {
    const q = msg("q", "claude", { options: AB, recommended: "B" });
    for (const status of ["waiting_andres", "waiting_claude", "working"] as const) {
      expect(ticketNeeds(input({ status, messages: [msg("m0", "andres"), q] }), NOW)).toEqual([
        { kind: "answer", label: "Responder", detail: "elige A o B · Claude recomienda B" },
      ]);
    }
    expect(ticketNeeds(input({ messages: [msg("q", "claude", { options: AB })] }), NOW)[0]?.detail).toBe("elige A o B");
    expect(kinds({ messages: [q, msg("a", "andres", { chosen: "A" })] })).toEqual([]);
  });

  it("Responder uses the open question, not the first message", () => {
    const old = msg("old", "claude", { options: [{ key: "X", label: "x" }, { key: "Y", label: "y" }], recommended: "X" });
    const open = msg("open", "claude", { options: AB, recommended: "A" });
    expect(ticketNeeds(input({ messages: [old, msg("a", "andres"), open] }), NOW)[0]?.detail).toBe("elige A o B · Claude recomienda A");
  });

  it("waiting_andres that nothing else explains is Responder, with Claude's last words", () => {
    expect(ticketNeeds(input({ status: "waiting_andres", messages: [msg("m", "claude", { body: "¿Seguimos con el plan B?" })] }), NOW)).toEqual([
      { kind: "answer", label: "Responder", detail: "¿Seguimos con el plan B?" },
    ]);
    expect(kinds({ status: "waiting_andres" })).toEqual(["answer"]);
    expect(kinds({ status: "waiting_claude", messages: [msg("m", "claude")] })).toEqual([]);
  });

  it("waiting_andres explained by a plan or an open review is not also Responder", () => {
    expect(kinds({ status: "waiting_andres", actions: [{ state: "planned", mode: "needs_ok" }] })).toEqual(["plan"]);
    expect(kinds({ status: "waiting_andres", reviews: [{ state: "open", findings: [{ state: "open" }] }] })).toEqual(["review"]);
  });

  it("Decidir review needs waiting_andres and an open review, and counts its open findings", () => {
    const reviews = [{ state: "open" as const, findings: [{ state: "open" }, { state: "open" }, { state: "fixed" }] }, { state: "approved" as const, findings: [{ state: "open" }] }];
    expect(ticketNeeds(input({ status: "waiting_andres", reviews }), NOW)).toEqual([{ kind: "review", label: "Decidir review", detail: "2 abiertos" }]);
    expect(kinds({ status: "working", reviews })).toEqual([]);
    expect(kinds({ status: "waiting_andres", reviews: [{ state: "approved", findings: [] }] })).toEqual(["answer"]);
  });

  it("orders permission > answer > plan > review > salida", () => {
    expect(
      kinds({
        status: "waiting_andres",
        messages: [msg("q", "claude", { options: AB })],
        actions: [{ state: "planned", mode: "needs_ok" }],
        approvals: [{ status: "pending", agent: "a", expiresAt: later }],
        reviews: [{ state: "open", findings: [] }],
        salidas: [{ status: "pending", title: "s" }],
      }),
    ).toEqual(["permission", "answer", "plan", "review", "salida"]);
  });
});

describe("needLine and needRank", () => {
  it("the first need leads, the others are appended as también", () => {
    const needs = ticketNeeds(input({ actions: [{ state: "planned", mode: "needs_ok" }], salidas: [{ status: "pending", title: "Hola" }] }), NOW);
    expect(needLine(needs)).toEqual({ lead: "Aprobar plan", rest: " · 1 paso te pide OK · también Firmar salida" });
    expect(needLine([])).toBeNull();
  });

  it("ranks by the first need; no need ranks last", () => {
    const plan = ticketNeeds(input({ actions: [{ state: "planned", mode: "needs_ok" }] }), NOW);
    const salida = ticketNeeds(input({ salidas: [{ status: "pending", title: "s" }] }), NOW);
    expect(needRank(plan)).toBeLessThan(needRank(salida));
    expect(needRank(salida)).toBeLessThan(needRank([]));
  });
});
