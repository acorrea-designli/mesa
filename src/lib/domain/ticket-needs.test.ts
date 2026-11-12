import { describe, expect, it } from "vitest";
import { needLine, needRank, ticketNeeds, type TicketNeedsInput } from "./ticket-needs";

const NOW = new Date("2026-11-09T12:00:00.000Z");
const later = "2026-11-09T13:00:00.000Z";
const earlier = "2026-11-09T11:00:00.000Z";

const msg = (id: string, author: "claude" | "andres", extra: Partial<TicketNeedsInput["messages"][number]> = {}) => ({
  id,
  author,
  body: id,
  ...extra,
});
const AB = [
  { key: "A", label: "Sí" },
  { key: "B", label: "No" },
];
const ABC = [...AB, { key: "C", label: "Otra" }];
type Q = TicketNeedsInput["questions"][number];
const q = (messageId: string, n: number, extra: Partial<Q> = {}): Q => ({
  messageId,
  n,
  options: AB,
  recommended: null,
  state: "open",
  createdAt: "2026-11-09T10:00:00.000Z",
  ...extra,
});
const input = (o: Partial<TicketNeedsInput> = {}): TicketNeedsInput => ({ status: "working", messages: [], questions: [], steps: [], actions: [], approvals: [], reviews: [], salidas: [], ...o });
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

  it("Responder: one open card question, from any status", () => {
    const messages = [msg("m0", "andres"), msg("q", "claude")];
    for (const status of ["waiting_andres", "waiting_claude", "working"] as const) {
      expect(ticketNeeds(input({ status, messages, questions: [q("q", 1, { recommended: "B" })] }), NOW)).toEqual([
        { kind: "answer", label: "Responder", detail: "elige A o B · Claude recomienda B" },
      ]);
    }
    expect(ticketNeeds(input({ messages, questions: [q("q", 1, { options: ABC })] }), NOW)[0]?.detail).toBe("elige A, B o C");
    expect(kinds({ messages: [...messages, msg("a", "andres")], questions: [q("q", 1, { state: "answered" })] })).toEqual([]);
    expect(kinds({ messages, questions: [q("q", 1, { state: "withdrawn" })] })).toEqual([]);
  });

  it("Responder counts every open question, across cards, with the recommended picks by step", () => {
    const messages = [msg("c1", "claude"), msg("a", "andres"), msg("c2", "claude")];
    const questions = [
      q("c1", 1, { recommended: "A", state: "answered" }),
      q("c1", 2, { recommended: "C", options: ABC }),
      q("c2", 1, { recommended: "B", createdAt: "2026-11-09T10:05:00.000Z" }),
      q("c2", 3, { recommended: null, createdAt: "2026-11-09T10:05:00.000Z" }),
    ];
    expect(ticketNeeds(input({ messages, questions }), NOW)).toEqual([
      { kind: "answer", label: "Responder", detail: "3 preguntas abiertas · Claude recomienda 2C 1B" },
    ]);
    // an Andrés message after a card does not close it: only the question rows say what is open
    expect(ticketNeeds(input({ messages: [msg("c", "claude"), msg("x", "andres")], questions: [q("c", 1), q("c", 2), q("c", 3, { recommended: "A" })] }), NOW)[0]?.detail).toBe(
      "3 preguntas abiertas · Claude recomienda 3A",
    );
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

  it("orders permission > answer > steps > plan > review > salida", () => {
    expect(
      kinds({
        status: "waiting_andres",
        messages: [msg("q", "claude")],
        questions: [q("q", 1)],
        steps: [{ state: "open", messageId: "c" }],
        actions: [{ state: "planned", mode: "needs_ok" }],
        approvals: [{ status: "pending", agent: "a", expiresAt: later }],
        reviews: [{ state: "open", findings: [] }],
        salidas: [{ status: "pending", title: "s" }],
      }),
    ).toEqual(["permission", "answer", "steps", "plan", "review", "salida"]);
  });
});

describe("Hacer pasos (checklist steps, t124)", () => {
  const st = (messageId: string, state: "open" | "done") => ({ messageId, state });

  it("an open step is a need with its count, in every non-closed status", () => {
    const steps = [st("c", "done"), st("c", "open"), st("c", "open"), st("c", "done"), st("c", "open")];
    for (const status of ["waiting_andres", "waiting_claude", "working"] as const) {
      expect(ticketNeeds(input({ status, steps }), NOW)).toEqual([{ kind: "steps", label: "Hacer pasos", detail: "2 de 5 hechos" }]);
    }
    expect(ticketNeeds(input({ status: "closed", steps }), NOW)).toEqual([]);
  });

  it("no open step, no need: a finished checklist owes nothing", () => {
    expect(kinds({ steps: [st("c", "done"), st("c", "done")] })).toEqual([]);
    expect(kinds({ steps: [] })).toEqual([]);
  });

  it("counts only the checklists that still have an open step", () => {
    expect(ticketNeeds(input({ steps: [st("a", "done"), st("a", "done"), st("b", "done"), st("b", "open")] }), NOW)[0]?.detail).toBe("1 de 2 hechos");
  });

  it("explains a waiting_andres ticket by itself: no generic Responder line next to it", () => {
    expect(kinds({ status: "waiting_andres", messages: [msg("c", "claude")], steps: [st("c", "open")] })).toEqual(["steps"]);
  });

  it("leads below an open question and above the plan", () => {
    const needs = ticketNeeds(input({ steps: [st("c", "open")], actions: [{ state: "planned", mode: "needs_ok" }] }), NOW);
    expect(needLine(needs)).toEqual({ lead: "Hacer pasos", rest: " · 0 de 1 hechos · también Aprobar plan" });
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
