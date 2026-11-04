import { describe, expect, it } from "vitest";
import { carryKeeps, clearTouched, countMarks, emptyModel, fromMarks, kindOf, markOutcome, paint, segments, snapToWords, toMarks } from "./marks";

const T = "Confirmed, SCOUT_API_URL is set on staging. Prod tentatively after 2pm.";

describe("semáforo mark model", () => {
  it("round-trips marks through the per-character model", () => {
    const marks = [
      { start: 0, end: 9, kind: "redo" as const, text: "Confirmed" },
      { start: 11, end: 24, kind: "keep" as const, text: "SCOUT_API_URL" },
    ];
    expect(toMarks(T, fromMarks(T, marks))).toEqual(marks);
  });

  it("snaps a partial selection to whole words and trims spaces", () => {
    expect(snapToWords(T, 2, 5)).toEqual([0, 9]);
    expect(T.slice(...snapToWords(T, 13, 30)!)).toBe("SCOUT_API_URL is set");
    expect(T.slice(...snapToWords(T, 9, 11)!)).toBe("Confirmed, SCOUT_API_URL"); // touches both words
    expect(snapToWords("a    b", 2, 4)).toBeNull(); // whitespace only
  });

  it("splits an existing mark when a different kind overlaps its middle", () => {
    let m = paint(emptyModel(T), 0, 24, "keep");
    m = paint(m, 11, 16, "drop");
    const marks = toMarks(T, m);
    expect(marks.map((x) => [x.kind, x.text])).toEqual([
      ["keep", "Confirmed, "],
      ["drop", "SCOUT"],
      ["keep", "_API_URL"],
    ]);
  });

  it("replaces a mark completely covered by a new one", () => {
    let m = paint(emptyModel(T), 11, 24, "redo");
    m = paint(m, 0, 30, "keep");
    expect(toMarks(T, m)).toHaveLength(1);
    expect(toMarks(T, m)[0]!.kind).toBe("keep");
  });

  it("Limpiar unwraps every run the range touches, whole", () => {
    let m = paint(emptyModel(T), 0, 9, "redo");
    m = paint(m, 11, 24, "keep");
    m = paint(m, 44, 48, "redo");
    const cleared = clearTouched(m, 5, 13);
    expect(toMarks(T, cleared).map((x) => x.text)).toEqual(["Prod"]);
    expect(clearTouched(m, 0, T.length).every((k) => k === null)).toBe(true);
  });

  it("reports the single kind of a range", () => {
    const m = paint(emptyModel(T), 0, 9, "redo");
    expect(kindOf(m, 0, 9)).toBe("redo");
    expect(kindOf(m, 0, 12)).toBeNull();
  });

  it("counts runs per kind", () => {
    let m = paint(emptyModel(T), 0, 9, "redo");
    m = paint(m, 11, 24, "keep");
    m = paint(m, 35, 42, "keep");
    expect(countMarks(toMarks(T, m))).toEqual({ keep: 2, redo: 1, drop: 0 });
  });

  it("splits render segments by kind and highlight", () => {
    const m = paint(emptyModel("ab cd ef"), 3, 5, "keep");
    const s = segments("ab cd ef", m, [4, 8]);
    expect(s.map((x) => [x.text, x.kind, x.hit])).toEqual([
      ["ab ", null, false],
      ["c", "keep", false],
      ["d", "keep", true],
      [" ef", null, true],
    ]);
    expect(s.map((x) => x.text).join("")).toBe("ab cd ef");
  });

  it("carries keep marks to identical text in the next version", () => {
    const prev = [
      { start: 11, end: 24, kind: "keep" as const, text: "SCOUT_API_URL" },
      { start: 0, end: 9, kind: "redo" as const, text: "Confirmed" },
      { start: 60, end: 69, kind: "keep" as const, text: "gone text" },
    ];
    const next = "All set: SCOUT_API_URL is set on staging.";
    expect(carryKeeps(prev, next)).toEqual([{ start: 9, end: 22, kind: "keep", text: "SCOUT_API_URL" }]);
  });

  it("summarises what the answer did with each mark", () => {
    const marks = [
      { start: 0, end: 9, kind: "redo" as const, text: "Confirmed" },
      { start: 11, end: 24, kind: "keep" as const, text: "SCOUT_API_URL" },
      { start: 49, end: 60, kind: "drop" as const, text: "tentatively" },
    ];
    const o = markOutcome(marks, "All set: SCOUT_API_URL is set on staging. Prod after 2pm.");
    expect(o.keep).toEqual({ total: 1, held: 1 });
    expect(o.redo.changed).toEqual(["Confirmed"]);
    expect(o.drop.gone).toEqual(["tentatively"]);
  });
});
