// API tests for question cards (t108): POST /api/tickets/:id/messages with questions (Claude) and answers (Andrés),
// zod-validated, 4xx without side effects; POST /api/questions/:id/withdraw.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as MESSAGE } from "@/app/api/tickets/[id]/messages/route";
import { POST as CREATE } from "@/app/api/tickets/route";
import { POST as WITHDRAW } from "@/app/api/questions/[id]/withdraw/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import type { TicketDetail, TicketQuestion } from "../domain/types";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
let ref: string;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" });
  ref = r.tickets.create({ direction: "andres_asks", title: "Haz algo", body: "Haz algo", ownerSession: "lead" }).ref;
});

const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const req = (body: unknown) => new Request("http://local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const post = (body: unknown, id = ref) => MESSAGE(req(body), ctx({ id }));
const AB = [
  { key: "A", label: "Sí" },
  { key: "B", label: "No" },
];
const CARD = [
  { text: "¿Uno?", options: AB, recommended: "A", recommendation: "porque sí" },
  { text: "¿Dos?", options: [...AB, { key: "C", label: "Tal vez", detail: "si hay tiempo" }], recommended: "C", recommendation: "flexible" },
];
const snapshot = () => {
  const d = r.tickets.detail(ref);
  return { messages: d.messages.length, questions: d.questions, status: d.status };
};

describe("POST /api/tickets/:id/messages with questions", () => {
  it("posts a card and puts the ticket in Te espera", async () => {
    const res = await post({ author: "claude", body: "Dos decisiones", questions: CARD, session: "lead" });
    expect(res.status).toBe(200);
    const d = (await res.json()) as TicketDetail;
    expect(d.status).toBe("waiting_andres");
    expect(d.questions.map((q) => [q.n, q.text, q.options.length, q.recommended, q.state])).toEqual([
      [1, "¿Uno?", 2, "A", "open"],
      [2, "¿Dos?", 3, "C", "open"],
    ]);
    expect(d.questions[1]!.options[2]).toEqual({ key: "C", label: "Tal vez", detail: "si hay tiempo" });
  });

  it("refuses bad cards with 400 and changes nothing", async () => {
    const before = snapshot();
    const six = ["A", "B", "C", "D", "E", "F"].map((key) => ({ key, label: key }));
    for (const questions of [
      [],
      Array.from({ length: 7 }, () => CARD[0]),
      [{ text: "¿?", options: [AB[0]] }],
      [{ text: "¿?", options: [...six, { key: "G", label: "g" }] }],
      [{ text: "¿?", options: [{ key: "A", label: "a" }, { key: "A", label: "b" }] }],
      [{ text: "¿?", options: AB, recommended: "C" }],
      [{ text: "¿?", options: [{ key: "A", label: "a" }, { key: "Z", label: "z" }] }],
      [{ options: AB }, { text: "¿Dos?", options: AB }],
    ]) {
      const res = await post({ author: "claude", body: "x", questions });
      expect(res.status, JSON.stringify(questions)).toBe(400);
    }
    expect((await post({ author: "andres", body: "x", questions: CARD })).status).toBe(400);
    expect((await post({ author: "claude", body: "x", options: [AB[0]] })).status).toBe(400);
    expect(snapshot()).toEqual(before);
  });

  it("a claude_asks ticket can open with a card too", async () => {
    const res = await CREATE(req({ direction: "claude_asks", title: "Varias", body: "Varias", questions: CARD, ownerSession: "lead" }), ctx());
    expect(res.status).toBe(201);
    expect(((await res.json()) as TicketDetail).questions).toHaveLength(2);
  });
});

describe("POST /api/tickets/:id/messages with answers", () => {
  let qs: TicketQuestion[];
  beforeEach(async () => {
    qs = ((await (await post({ author: "claude", body: "Dos", questions: CARD, session: "lead" })).json()) as TicketDetail).questions;
  });

  it("answers any subset in one message", async () => {
    const res = await post({ author: "andres", answers: [{ questionId: qs[1]!.id, chosen: "C", text: "pero rápido" }] });
    expect(res.status).toBe(200);
    const d = (await res.json()) as TicketDetail;
    expect(d.questions.map((q) => [q.state, q.chosen, q.answerText])).toEqual([
      ["open", null, null],
      ["answered", "C", "pero rápido"],
    ]);
  });

  it("4xx for a question not open (409), not in the ticket, an unknown key, or an empty answer (400); nothing changes", async () => {
    await post({ author: "andres", answers: [{ questionId: qs[0]!.id, chosen: "A" }] });
    const other = r.tickets.create({ direction: "claude_asks", title: "Otro", body: "Otro", options: AB, ownerSession: "lead" }).questions[0]!;
    const before = snapshot();
    const cases: [unknown, number][] = [
      [[{ questionId: qs[0]!.id, chosen: "B" }], 409],
      [[{ questionId: other.id, chosen: "A" }], 400],
      [[{ questionId: qs[1]!.id, chosen: "F" }], 400],
      [[{ questionId: qs[1]!.id }], 400],
      [[{ questionId: qs[1]!.id, text: "   " }], 400],
      [[], 400],
    ];
    for (const [answers, status] of cases) {
      const res = await post({ author: "andres", body: "hola", answers });
      expect(res.status, JSON.stringify(answers)).toBe(status);
    }
    expect((await post({ author: "claude", body: "x", answers: [{ questionId: qs[1]!.id, chosen: "A" }] })).status).toBe(400);
    // a lone chosen with two questions open is ambiguous
    await post({ author: "claude", body: "otra", options: AB, session: "lead" });
    const before2 = snapshot();
    expect((await post({ author: "andres", chosen: "A" })).status).toBe(400);
    expect(snapshot()).toEqual(before2);
    expect(before2.messages).toBe(before.messages + 1);
  });
});

describe("POST /api/questions/:id/withdraw", () => {
  it("withdraws an open question with its reason; 409 when not open, 404 unknown, 400 without a reason", async () => {
    const q = r.tickets.addMessage(ref, { author: "claude", body: "Dos", questions: CARD, session: "lead" }).questions[0]!;
    const w = (body: unknown, id = q.id) => WITHDRAW(req(body), ctx({ id }));
    expect((await w({})).status).toBe(400);
    expect((await w({ reason: "  " })).status).toBe(400);
    const res = await w({ reason: "ya respondida en el hilo" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: q.id, state: "withdrawn", withdrawReason: "ya respondida en el hilo" });
    expect((await w({ reason: "otra vez" })).status).toBe(409);
    expect((await w({ reason: "x" }, "tq_nope")).status).toBe(404);
  });
});
