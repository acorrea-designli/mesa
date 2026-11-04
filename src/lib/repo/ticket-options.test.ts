import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "./index";

let r: Repos;
const T0 = new Date("2026-11-03T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const AB = [
  { key: "A", label: "Sí" },
  { key: "B", label: "No" },
];

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
});

const chosenOf = (ref: string) => r.tickets.detail(ref).messages.filter((m) => m.author === "andres").map((m) => m.chosen);

describe("a typed option key records chosen", () => {
  it("maps a lone key (any case, trailing punctuation) to the open options message", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "¿Merge?", body: "¿Merge?", options: AB, ownerSession: "lead" }, T0);
    r.tickets.addMessage(t.id, { author: "andres", body: " b. " }, at(1000));
    expect(chosenOf(t.id)).toEqual(["B"]);
  });

  it("uses the options of a later message, not the first", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "Q", body: "Q", options: AB, ownerSession: "lead" }, T0);
    r.tickets.addMessage(t.id, { author: "andres", body: "A" }, at(1000));
    r.tickets.addMessage(t.id, { author: "claude", body: "¿Y ahora?", options: [...AB, { key: "X", label: "Otra" }] }, at(2000));
    r.tickets.addMessage(t.id, { author: "andres", body: "x" }, at(3000));
    expect(chosenOf(t.id)).toEqual(["A", "X"]);
  });

  it("longer text is a normal reply with no chosen", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "Q", body: "Q", options: AB, ownerSession: "lead" }, T0);
    r.tickets.addMessage(t.id, { author: "andres", body: "A pero con calma" }, at(1000));
    expect(chosenOf(t.id)).toEqual([null]);
  });

  it("does nothing once the options are answered, or when there are none", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "Q", body: "Q", options: AB, ownerSession: "lead" }, T0);
    r.tickets.addMessage(t.id, { author: "andres", body: "A" }, at(1000));
    r.tickets.addMessage(t.id, { author: "andres", body: "B" }, at(2000)); // already answered
    expect(chosenOf(t.id)).toEqual(["A", null]);
    const plain = r.tickets.create({ direction: "claude_asks", title: "P", body: "P", ownerSession: "lead" }, at(5000));
    r.tickets.addMessage(plain.id, { author: "andres", body: "A" }, at(6000));
    expect(chosenOf(plain.id)).toEqual([null]);
  });

  it("an explicit chosen is kept as given, and Claude's own messages are never mapped", () => {
    const t = r.tickets.create({ direction: "claude_asks", title: "Q", body: "Q", options: AB, ownerSession: "lead" }, T0);
    r.tickets.addMessage(t.id, { author: "claude", body: "A", session: "lead" }, at(500));
    r.tickets.addMessage(t.id, { author: "andres", body: "texto", chosen: "B" }, at(1000));
    expect(r.tickets.detail(t.id).messages.map((m) => m.chosen)).toEqual([null, null, "B"]);
  });

  it("an andres_asks ticket whose Claude reply has options maps too", () => {
    const t = r.tickets.create({ direction: "andres_asks", title: "Haz algo", body: "Haz algo", ownerSession: "lead" }, T0);
    r.tickets.addMessage(t.id, { author: "claude", body: "¿Cómo?", options: AB, recommended: "A", recommendation: "más simple" }, at(1000));
    r.tickets.addMessage(t.id, { author: "andres", body: "A" }, at(2000));
    expect(chosenOf(t.id)).toEqual([null, "A"]);
  });
});
