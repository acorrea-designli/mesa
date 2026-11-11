import { describe, expect, it } from "vitest";
import { answersBody, cardProblem, keysLine, openInOrder, parseShorthand, questionText, recommendedLine } from "./ticket-questions";

const AB = [
  { key: "A", label: "Sí" },
  { key: "B", label: "No" },
];
const ABC = [...AB, { key: "C", label: "Más tarde" }];
const T1 = "2026-11-11T10:00:00.000Z";
const T2 = "2026-11-11T11:00:00.000Z";
const open = (id: string, n: number, extra: { messageId?: string; options?: typeof AB; createdAt?: string; state?: "open" | "answered" | "withdrawn" } = {}) => ({
  id,
  n,
  messageId: extra.messageId ?? "m1",
  options: extra.options ?? ABC,
  state: extra.state ?? ("open" as const),
  createdAt: extra.createdAt ?? T1,
});

describe("cardProblem", () => {
  it("accepts 1-6 questions of 2-6 options with unique keys A-F and the recommended key among them", () => {
    expect(cardProblem([{ text: "¿Q?", options: AB, recommended: "A" }])).toBeNull();
    const six = ["A", "B", "C", "D", "E", "F"].map((key) => ({ key, label: key }));
    expect(cardProblem(Array.from({ length: 6 }, (_, i) => ({ text: `Q${i}`, options: six, recommended: "F" })), { requireText: true })).toBeNull();
  });

  it("refuses bad cards with a reason", () => {
    expect(cardProblem([])).toMatch(/1-6 questions/);
    expect(cardProblem(Array.from({ length: 7 }, () => ({ text: "q", options: AB })))).toMatch(/1-6 questions/);
    expect(cardProblem([{ options: [AB[0]!] }])).toMatch(/2-6 options/);
    expect(cardProblem([{ options: [...ABC, ...ABC.map((o) => ({ ...o, key: o.key + "x" })), { key: "G", label: "g" }] }])).toMatch(/2-6 options/);
    expect(cardProblem([{ options: [{ key: "A", label: "a" }, { key: "A", label: "b" }] }])).toMatch(/unique/);
    expect(cardProblem([{ options: [{ key: "A", label: "a" }, { key: "X", label: "x" }] }])).toMatch(/A-F/);
    expect(cardProblem([{ options: AB, recommended: "C" }])).toMatch(/not one of its options/);
    expect(cardProblem([{ text: "", options: AB }, { text: "b", options: AB }], { requireText: true })).toMatch(/question 1 has no text/);
  });
});

describe("parseShorthand", () => {
  const qs = [open("q1", 1), open("q2", 2), open("q3", 3)];

  it("maps numbered picks, whatever the separators", () => {
    expect(parseShorthand("1A 2C", qs)).toEqual([
      { questionId: "q1", chosen: "A" },
      { questionId: "q2", chosen: "C" },
    ]);
    expect(parseShorthand("1: B, 2-A", qs)).toEqual([
      { questionId: "q1", chosen: "B" },
      { questionId: "q2", chosen: "A" },
    ]);
    expect(parseShorthand("1a y 3c.", qs)).toEqual([
      { questionId: "q1", chosen: "A" },
      { questionId: "q3", chosen: "C" },
    ]);
    expect(parseShorthand("2) b; 3. a", qs)).toEqual([
      { questionId: "q2", chosen: "B" },
      { questionId: "q3", chosen: "A" },
    ]);
  });

  it("a bare key answers only when exactly one question is open", () => {
    expect(parseShorthand("A", qs)).toEqual([]);
    expect(parseShorthand(" b. ", [open("q2", 2)])).toEqual([{ questionId: "q2", chosen: "B" }]);
    expect(parseShorthand("A)", [open("q1", 1), open("q2", 2, { state: "answered" })])).toEqual([{ questionId: "q1", chosen: "A" }]);
    expect(parseShorthand("D", [open("q1", 1)])).toEqual([]);
  });

  it("anything else is a comment and answers nothing", () => {
    for (const text of ["A pero con calma", "1A pero con calma", "1 a la semana", "4A", "1A 1B", "1D", "2 de 3", "", "ok"]) {
      expect(parseShorthand(text, qs)).toEqual([]);
    }
    expect(parseShorthand("1A", [])).toEqual([]);
  });

  it("a step number shared by two open cards names the newest card", () => {
    const two = [open("old", 1, { messageId: "m1", createdAt: T1 }), open("new", 1, { messageId: "m2", createdAt: T2 })];
    expect(parseShorthand("1B", two)).toEqual([{ questionId: "new", chosen: "B" }]);
  });
});

describe("helpers", () => {
  const card = [
    { id: "q1", n: 1, messageId: "m1", options: ABC, recommended: "A" },
    { id: "q2", n: 2, messageId: "m1", options: AB, recommended: null },
    { id: "q3", n: 3, messageId: "m1", options: AB, recommended: "B" },
  ];

  it("answersBody: one pick on a 1-step card as before, numbered on a card of several, his words kept", () => {
    expect(answersBody([{ questionId: "q1", chosen: "C" }], [card[0]!])).toBe("C. Más tarde");
    expect(answersBody([{ questionId: "q1", chosen: "C" }], card)).toBe("1C. Más tarde");
    expect(answersBody([{ questionId: "q2", text: "depende" }], card)).toBe("2. depende");
    expect(answersBody([{ questionId: "q1", chosen: "A" }, { questionId: "q2", text: "depende del cliente" }], card)).toBe("1A. Sí\n2. depende del cliente");
    expect(answersBody([{ questionId: "q3", chosen: "B", text: "pero ojo" }, { questionId: "q1", chosen: "A" }], card)).toBe("3B. No · pero ojo\n1A. Sí");
  });

  it("recommendedLine numbers the picks only when there are several", () => {
    expect(recommendedLine(card)).toBe("1A 3B");
    expect(recommendedLine([card[2]!])).toBe("B");
    expect(recommendedLine([card[1]!])).toBe("");
  });

  it("keysLine and questionText", () => {
    expect(keysLine(AB)).toBe("A o B");
    expect(keysLine(ABC)).toBe("A, B o C");
    expect(questionText({ text: "  ¿Merge? " })).toBe("¿Merge?");
    expect(questionText({ text: "" }, "\n¿A o B?\nDetalle")).toBe("¿A o B?");
    expect(questionText({ text: "" }, "")).toBe("Claude espera una elección");
  });

  it("openInOrder: open ones only, card by card in thread order, then by step", () => {
    const qs = [
      { ...open("b2", 2, { messageId: "mb", createdAt: T2 }) },
      { ...open("a1", 1, { messageId: "ma", createdAt: T1, state: "answered" }) },
      { ...open("b1", 1, { messageId: "mb", createdAt: T2 }) },
      { ...open("a2", 2, { messageId: "ma", createdAt: T1 }) },
    ];
    expect(openInOrder(qs, [{ id: "ma" }, { id: "mb" }]).map((q) => q.id)).toEqual(["a2", "b1", "b2"]);
  });
});
