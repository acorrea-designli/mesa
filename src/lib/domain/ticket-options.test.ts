import { describe, expect, it } from "vitest";
import { matchOptionKey, openOptions, optionStates, optionText } from "./ticket-options";

const opts = (...keys: string[]) => keys.map((key) => ({ key, label: `Opción ${key}` }));
let n = 0;
const msg = (author: "claude" | "andres", o: { options?: string[]; chosen?: string } = {}) => ({
  id: `m${++n}`,
  author,
  options: o.options ? opts(...o.options) : null,
  chosen: o.chosen ?? null,
});

describe("optionStates", () => {
  it("only the latest unanswered options message is actionable", () => {
    const first = msg("claude", { options: ["A", "B"] });
    const reply = msg("andres", { chosen: "A" });
    const later = msg("claude", { options: ["A", "B", "X"] });
    const s = optionStates([first, reply, later]);
    expect(s.get(first.id)).toEqual({ actionable: false, chosen: "A", answered: true });
    expect(s.get(later.id)).toEqual({ actionable: true, chosen: null, answered: false });
  });

  it("two unanswered options messages: only the later one is live", () => {
    const a = msg("claude", { options: ["A", "B"] });
    const b = msg("claude", { options: ["A", "B"] });
    const s = optionStates([a, b]);
    expect(s.get(a.id)?.actionable).toBe(false);
    expect(s.get(b.id)?.actionable).toBe(true);
  });

  it("answering in words closes the message without marking an option", () => {
    const a = msg("claude", { options: ["A", "B"] });
    const s = optionStates([a, msg("andres"), msg("claude")]);
    expect(s.get(a.id)).toEqual({ actionable: false, chosen: null, answered: true });
  });

  it("a Claude message after the options does not answer them", () => {
    const a = msg("claude", { options: ["A", "B"] });
    expect(optionStates([a, msg("claude")]).get(a.id)?.actionable).toBe(true);
  });

  it("messages without options have no state", () => {
    expect(optionStates([msg("claude"), msg("andres")]).size).toBe(0);
  });
});

describe("optionText", () => {
  it("reads the label from the message the click came from, not the first", () => {
    const first = { options: [{ key: "A", label: "Sí" }] };
    const later = { options: [{ key: "A", label: "Mergear ya" }] };
    expect(optionText(first, "A")).toBe("A. Sí");
    expect(optionText(later, "A")).toBe("A. Mergear ya");
    expect(optionText(later, "Z")).toBe("Z");
    expect(optionText(undefined, "A")).toBe("A");
  });
});

describe("matchOptionKey", () => {
  const o = opts("A", "B", "x");
  it("maps a lone key, case-insensitive, with optional trailing punctuation and spaces", () => {
    expect(matchOptionKey("A", o)).toBe("A");
    expect(matchOptionKey("b.", o)).toBe("B");
    expect(matchOptionKey(" B ", o)).toBe("B");
    expect(matchOptionKey("a)", o)).toBe("A");
    expect(matchOptionKey("X!", o)).toBe("x");
  });
  it("longer text or an unknown key is a normal reply", () => {
    expect(matchOptionKey("A pero más tarde", o)).toBeNull();
    expect(matchOptionKey("C", o)).toBeNull();
    expect(matchOptionKey("", o)).toBeNull();
    expect(matchOptionKey("A", null)).toBeNull();
  });
});

describe("openOptions", () => {
  it("is the options of the latest unanswered message, none when answered", () => {
    const a = msg("claude", { options: ["A", "B"] });
    expect(openOptions([a])?.map((x) => x.key)).toEqual(["A", "B"]);
    expect(openOptions([a, msg("andres", { chosen: "A" })])).toBeNull();
  });
});
