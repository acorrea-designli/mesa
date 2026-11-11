import { describe, expect, it } from "vitest";
import { answersOf, firstStep, livePicks, nextOpenStep, pickCount, setPickText, stepState, togglePick } from "./card";

const AB = [
  { key: "A", label: "Sí" },
  { key: "B", label: "No" },
];
const q = (id: string, state: "open" | "answered" | "withdrawn" = "open") => ({ id, state, options: AB });
const card = [q("q1", "answered"), q("q2"), q("q3"), q("q4", "withdrawn"), q("q5")];

describe("question card stepper", () => {
  it("step states: answered and withdrawn as stored, open ones picked once they have a key or words", () => {
    const picks = { q2: { chosen: "B" }, q3: { text: "  " }, q5: { text: "depende" } };
    expect(card.map((x) => stepState(x, picks))).toEqual(["answered", "picked", "open", "withdrawn", "picked"]);
    expect(stepState(q("q2"), { q2: { chosen: "Z" } })).toBe("open"); // a key the question does not have is no pick
  });

  it("opens on the first open step without a pick", () => {
    expect(firstStep(card, {})).toBe(1);
    expect(firstStep(card, { q2: { chosen: "A" } })).toBe(2);
    expect(firstStep(card, { q2: { chosen: "A" }, q3: { chosen: "A" }, q5: { chosen: "B" } })).toBe(1);
    expect(firstStep([q("x", "answered")], {})).toBe(0);
  });

  it("a pick moves to the next open step without a pick, wrapping, else stays", () => {
    expect(nextOpenStep(card, { q2: { chosen: "A" } }, 1)).toBe(2);
    expect(nextOpenStep(card, { q3: { chosen: "A" } }, 2)).toBe(4); // skips the withdrawn step
    expect(nextOpenStep(card, { q5: { chosen: "A" } }, 4)).toBe(1); // wraps to the first open one
    expect(nextOpenStep(card, { q2: { chosen: "A" }, q3: { chosen: "B" }, q5: { chosen: "A" } }, 4)).toBe(4);
  });

  it("counts n de k over the open questions and sends one answer per pick", () => {
    const picks = { q1: { chosen: "A" }, q2: { chosen: "B", text: " ojo " }, q5: { text: "con mis palabras" } };
    expect(pickCount(card, picks)).toEqual({ n: 2, k: 3 });
    expect(answersOf(card, picks)).toEqual([
      { questionId: "q2", chosen: "B", text: "ojo" },
      { questionId: "q5", text: "con mis palabras" },
    ]);
    expect(livePicks(card, picks)).toEqual({ q2: picks.q2, q5: picks.q5 });
  });

  it("toggling a key twice takes it back; empty picks leave the map", () => {
    let p = togglePick({}, "q2", "A");
    expect(p).toEqual({ q2: { chosen: "A" } });
    p = togglePick(p, "q2", "B");
    expect(p).toEqual({ q2: { chosen: "B" } });
    p = setPickText(p, "q2", "y algo");
    expect(p).toEqual({ q2: { chosen: "B", text: "y algo" } });
    p = togglePick(setPickText(p, "q2", ""), "q2", "B");
    expect(p).toEqual({});
  });
});
