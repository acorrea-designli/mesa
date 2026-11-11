// Question cards in the repo (t108): explicit per-question state, answers in one message, the ticket.answered wake,
// typed shorthand, withdraw and close, the needs line and the resume payload.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { ticketNeeds } from "../domain/ticket-needs";
import { eventsAfter } from "../wake/wake";
import { createRepos, type Repos } from "./index";

let r: Repos;
const T0 = new Date("2026-11-03T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const AB = [
  { key: "A", label: "Sí" },
  { key: "B", label: "No" },
];
const ABC = [...AB, { key: "C", label: "Más tarde" }];
const CARD = [
  { text: "¿Bucket nuevo?", options: AB, recommended: "A", recommendation: "aísla datos" },
  { text: "¿Región?", options: ABC, recommended: "C", recommendation: "más barata" },
  { text: "¿Cuándo?", options: AB, recommended: "B", recommendation: "sin prisa" },
];

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
});

const request = () => r.tickets.create({ direction: "andres_asks", title: "Haz algo", body: "Haz algo", ownerSession: "lead" }, T0);
const states = (ref: string) => r.tickets.detail(ref).questions.map((q) => q.state);
const answeredWakes = () => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === "ticket.answered").map((e) => e.payload);
const needsOf = (ref: string) => {
  const d = r.tickets.detail(ref);
  return ticketNeeds({ status: d.status, messages: d.messages, questions: d.questions, actions: d.actions, approvals: [], reviews: [], salidas: [] }, T0);
};

describe("a question card", () => {
  it("is one Claude message with its questions as rows, all open, and puts the ticket in Te espera", () => {
    const t = request();
    const d = r.tickets.addMessage(t.id, { author: "claude", body: "Tres decisiones", questions: CARD, session: "lead" }, at(1000));
    expect(d.status).toBe("waiting_andres");
    const card = d.messages.at(-1)!;
    expect(card.options).toBeNull();
    expect(d.questions.map((q) => [q.messageId, q.n, q.text, q.state, q.recommended])).toEqual([
      [card.id, 1, "¿Bucket nuevo?", "open", "A"],
      [card.id, 2, "¿Región?", "open", "C"],
      [card.id, 3, "¿Cuándo?", "open", "B"],
    ]);
    expect(d.questions[0]!.id).toMatch(/^tq_/);
  });

  it("--option still works: one question becomes a 1-step card whose body is the question", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "¿Merge?", body: "¿Merge?", options: AB, recommended: "B", recommendation: "espera CI", ownerSession: "lead" }, T0);
    expect(t.questions).toMatchObject([{ n: 1, text: "", options: AB, recommended: "B", recommendation: "espera CI", state: "open" }]);
  });

  it("refuses a bad card or a card from Andrés, and changes nothing", () => {
    const t = request();
    expect(() => r.tickets.addMessage(t.id, { author: "claude", questions: [{ text: "Q", options: [AB[0]!] }] })).toThrow(/2-6 options/);
    expect(() => r.tickets.addMessage(t.id, { author: "claude", questions: [{ text: "", options: AB }, { text: "Q2", options: AB }] })).toThrow(/no text/);
    expect(() => r.tickets.addMessage(t.id, { author: "andres", body: "x", options: AB })).toThrow(/only Claude/);
    expect(r.tickets.detail(t.id).messages).toHaveLength(1);
    expect(r.tickets.detail(t.id).questions).toEqual([]);
  });
});

describe("answers", () => {
  it("a partial answer closes only what it names, leaves the rest open and wakes once with the answers and openLeft", () => {
    const t = request();
    const qs = r.tickets.addMessage(t.id, { author: "claude", body: "Tres", questions: CARD, session: "lead" }, at(1000)).questions;
    const d = r.tickets.addMessage(t.id, { author: "andres", answers: [{ questionId: qs[0]!.id, chosen: "A" }, { questionId: qs[1]!.id, text: "la de siempre" }] }, at(2000));
    expect(states(t.ref)).toEqual(["answered", "answered", "open"]);
    const msg = d.messages.at(-1)!;
    expect(msg.body).toBe("1A. Sí\n2. la de siempre");
    expect(d.questions[0]).toMatchObject({ chosen: "A", answerText: null, answerMessageId: msg.id, answeredAt: at(2000).toISOString() });
    expect(d.questions[1]).toMatchObject({ chosen: null, answerText: "la de siempre", answerMessageId: msg.id });
    expect(answeredWakes()).toEqual([
      {
        ref: t.ref,
        messageId: msg.id,
        chosen: null,
        answers: [
          { questionId: qs[0]!.id, n: 1, chosen: "A", label: "Sí", text: null },
          { questionId: qs[1]!.id, n: 2, chosen: null, label: null, text: "la de siempre" },
        ],
        openLeft: 1,
      },
    ]);
    // the card is still live for the rest
    expect(needsOf(t.ref)[0]?.detail).toBe("elige A o B · Claude recomienda B");
  });

  it("a lone pick keeps chosen on the message, and his own words stay the body", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "¿Merge?", body: "¿Merge?", options: AB, ownerSession: "lead" }, T0);
    const q = t.questions[0]!;
    const d = r.tickets.addMessage(t.id, { author: "andres", body: "dale", answers: [{ questionId: q.id, chosen: "B" }] }, at(1000));
    expect(d.messages.at(-1)).toMatchObject({ body: "dale", chosen: "B" });
    expect(answeredWakes()[0]).toMatchObject({ chosen: "B", openLeft: 0, answers: [{ n: 1, chosen: "B", label: "No" }] });
  });

  it("an explicit chosen (an older client) answers the one open question", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "Q", body: "Q", options: AB, ownerSession: "lead" }, T0);
    r.tickets.addMessage(t.id, { author: "andres", body: "B. No", chosen: "B" }, at(1000));
    expect(r.tickets.detail(t.id).questions[0]).toMatchObject({ state: "answered", chosen: "B" });
  });

  it("is refused (4xx) for a question that is not open, not in the ticket, or a key it lacks; nothing changes", () => {
    const t = request();
    const qs = r.tickets.addMessage(t.id, { author: "claude", body: "Tres", questions: CARD, session: "lead" }, at(1000)).questions;
    const other = r.tickets.create({ direction: "claude_asks", title: "Otro", body: "Otro", options: AB, ownerSession: "lead" }, at(1500)).questions[0]!;
    r.tickets.addMessage(t.id, { author: "andres", answers: [{ questionId: qs[0]!.id, chosen: "A" }] }, at(2000));
    const before = r.tickets.detail(t.id);
    const bad = [
      [{ questionId: qs[0]!.id, chosen: "B" }], // already answered
      [{ questionId: other.id, chosen: "A" }], // another ticket
      [{ questionId: qs[1]!.id, chosen: "D" }], // no such key
      [{ questionId: "tq_nope", chosen: "A" }],
      [{ questionId: qs[1]!.id, chosen: "A" }, { questionId: qs[1]!.id, chosen: "B" }], // twice
      [{ questionId: qs[1]!.id, chosen: "A" }, { questionId: qs[0]!.id, chosen: "A" }], // one good, one closed: all or nothing
    ];
    const names: string[] = [];
    for (const answers of bad) {
      try {
        r.tickets.addMessage(t.id, { author: "andres", answers }, at(3000));
      } catch (e) {
        names.push((e as Error).name);
      }
    }
    expect(names).toEqual(["TransitionError", "ValidationError", "ValidationError", "ValidationError", "ValidationError", "TransitionError"]);
    const after = r.tickets.detail(t.id);
    expect(after.messages).toHaveLength(before.messages.length);
    expect(after.questions).toEqual(before.questions);
    expect(answeredWakes()).toHaveLength(1);
  });

  it("Claude cannot answer", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "Q", body: "Q", options: AB, ownerSession: "lead" }, T0);
    expect(() => r.tickets.addMessage(t.id, { author: "claude", answers: [{ questionId: t.questions[0]!.id, chosen: "A" }] })).toThrow(/only Andrés/);
  });
});

describe("a question stays open until answered or withdrawn", () => {
  it("later Claude messages, plans, notes, new cards and replies that answer nothing never close or hide it", () => {
    const t = request();
    const first = r.tickets.addMessage(t.id, { author: "claude", body: "¿A o B?", options: AB, session: "lead" }, at(1000)).questions[0]!;
    r.tickets.addMessage(t.id, { author: "claude", body: "FYI: sigo", session: "lead" }, at(2000));
    r.tickets.addMessage(t.id, { author: "claude", body: "¿Seguro?", ask: true, session: "lead" }, at(2500));
    r.tickets.plan(t.id, [{ kind: "investigate", source: "github", label: "Leer", mode: "direct" }], "lead", at(3000));
    r.tickets.note(t.id, { body: "Mesa: un mensaje de Slack" }, at(4000));
    r.tickets.addMessage(t.id, { author: "claude", body: "Otra", questions: [{ text: "¿Región?", options: ABC }, { text: "¿Cuándo?", options: AB }], session: "lead" }, at(5000));
    r.tickets.addMessage(t.id, { author: "andres", body: "lo pienso y te digo" }, at(6000));
    r.tickets.addMessage(t.id, { author: "andres", body: "A" }, at(7000)); // a bare key with 3 open: a comment
    expect(states(t.ref)).toEqual(["open", "open", "open"]);
    expect(r.tickets.detail(t.ref).questions[0]!.id).toBe(first.id);
    expect(needsOf(t.ref)[0]?.detail).toBe("3 preguntas abiertas");
    expect(answeredWakes().map((p) => [p.answers, p.openLeft])).toEqual([
      [[], 3],
      [[], 3],
    ]);
  });

  it("withdraw closes one open question with its reason; a second withdraw or an answer to it is 409", () => {
    const t = request();
    const qs = r.tickets.addMessage(t.id, { author: "claude", body: "Dos", questions: CARD.slice(0, 2), session: "lead" }, at(1000)).questions;
    const w = r.tickets.withdrawQuestion(qs[0]!.id, "ya lo dijiste en el hilo", at(2000));
    expect(w).toMatchObject({ state: "withdrawn", withdrawReason: "ya lo dijiste en el hilo" });
    expect(() => r.tickets.withdrawQuestion(qs[0]!.id, "otra vez")).toThrow(/withdrawn/);
    expect(() => r.tickets.withdrawQuestion("tq_nope", "x")).toThrow(/not found/);
    expect(() => r.tickets.withdrawQuestion(qs[1]!.id, "  ")).toThrow(/reason/);
    expect(() => r.tickets.addMessage(t.id, { author: "andres", answers: [{ questionId: qs[0]!.id, chosen: "A" }] })).toThrow(/withdrawn/);
    expect(states(t.ref)).toEqual(["withdrawn", "open"]);
    expect(eventsAfter(r.db, "lead", 0).filter((e) => e.kind !== "ticket.created")).toEqual([]);
  });

  it("closing the ticket withdraws its open questions, and a reopen does not bring them back", () => {
    const t = request();
    const qs = r.tickets.addMessage(t.id, { author: "claude", body: "Dos", questions: CARD.slice(0, 2), session: "lead" }, at(1000)).questions;
    r.tickets.addMessage(t.id, { author: "andres", answers: [{ questionId: qs[0]!.id, chosen: "B" }] }, at(2000));
    r.tickets.transition(t.id, { type: "close", by: "andres" }, undefined, at(3000));
    expect(r.tickets.detail(t.id).questions.map((q) => [q.state, q.withdrawReason])).toEqual([
      ["answered", null],
      ["withdrawn", "Ticket cerrado"],
    ]);
    r.tickets.transition(t.id, { type: "reopen", by: "andres" }, undefined, at(4000));
    expect(states(t.ref)).toEqual(["answered", "withdrawn"]);
  });
});

describe("typed shorthand", () => {
  it("maps numbered picks to answers and a bare key only with exactly one open question", () => {
    const t = request();
    r.tickets.addMessage(t.id, { author: "claude", body: "Tres", questions: CARD, session: "lead" }, at(1000));
    r.tickets.addMessage(t.id, { author: "andres", body: "1: B, 2-C" }, at(2000));
    expect(r.tickets.detail(t.id).questions.map((q) => [q.state, q.chosen])).toEqual([
      ["answered", "B"],
      ["answered", "C"],
      ["open", null],
    ]);
    expect(r.tickets.detail(t.id).messages.at(-1)).toMatchObject({ body: "1: B, 2-C", chosen: null });
    r.tickets.addMessage(t.id, { author: "andres", body: " a. " }, at(3000));
    expect(r.tickets.detail(t.id).questions[2]).toMatchObject({ state: "answered", chosen: "A" });
    expect(answeredWakes().map((p) => p.openLeft)).toEqual([1, 0]);
  });

  it("a lone key, any case and punctuation, answers a 1-step card; longer text is a comment", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "¿Merge?", body: "¿Merge?", options: AB, ownerSession: "lead" }, T0);
    r.tickets.addMessage(t.id, { author: "andres", body: "A pero con calma" }, at(1000));
    expect(states(t.ref)).toEqual(["open"]);
    r.tickets.addMessage(t.id, { author: "andres", body: " b. " }, at(2000));
    expect(r.tickets.detail(t.id).questions[0]).toMatchObject({ state: "answered", chosen: "B" });
    expect(r.tickets.detail(t.id).messages.map((m) => m.chosen)).toEqual([null, null, "B"]);
  });

  it("an answered question is not answered again by a later key", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "Q", body: "Q", options: AB, ownerSession: "lead" }, T0);
    r.tickets.addMessage(t.id, { author: "andres", body: "A" }, at(1000));
    r.tickets.addMessage(t.id, { author: "andres", body: "B" }, at(2000));
    expect(r.tickets.detail(t.id).questions[0]).toMatchObject({ chosen: "A" });
    expect(r.tickets.detail(t.id).messages.map((m) => m.chosen)).toEqual([null, "A", null]);
  });
});

describe("the resume payload", () => {
  it("lists every question with its state, and openQuestions from the open rows", () => {
    const t = request();
    r.agents.putBrief(t.ref, { openQuestions: ["¿Hay presupuesto?"] }, at(500));
    const qs = r.tickets.addMessage(t.id, { author: "claude", body: "Tres", questions: CARD, session: "lead" }, at(1000)).questions;
    r.tickets.addMessage(t.id, { author: "claude", body: "¿Merge ya?\nDetalle", options: AB, session: "lead" }, at(1500));
    r.tickets.addMessage(t.id, { author: "andres", answers: [{ questionId: qs[1]!.id, chosen: "C" }] }, at(2000));
    r.tickets.withdrawQuestion(qs[2]!.id, "moot", at(2500));
    const c = r.agents.context(t.ref);
    expect(c.questions.map((q) => [q.n, q.state, q.chosen])).toEqual([
      [1, "open", null],
      [2, "answered", "C"],
      [3, "withdrawn", null],
      [1, "open", null],
    ]);
    expect(c.openQuestions).toEqual(["¿Hay presupuesto?", `${qs[0]!.id} · 1. ¿Bucket nuevo?`, `${c.questions[3]!.id} · 1. ¿Merge ya?`]);
  });
});
