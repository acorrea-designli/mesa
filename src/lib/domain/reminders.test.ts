import { describe, expect, it } from "vitest";
import { dueLabel, parseWhen, returnsLabel } from "./reminders";

describe("parseWhen", () => {
  it("reads a zoneless date and time in Bogota", () => {
    expect(parseWhen("2026-11-18T09:00")).toBe("2026-11-18T14:00:00.000Z");
    expect(parseWhen("2026-11-18 09:30")).toBe("2026-11-18T14:30:00.000Z");
  });
  it("reads a bare date as 09:00 in Bogota", () => {
    expect(parseWhen("2026-11-18")).toBe("2026-11-18T14:00:00.000Z");
  });
  it("keeps an explicit zone", () => {
    expect(parseWhen("2026-11-18T09:00:00Z")).toBe("2026-11-18T09:00:00.000Z");
    expect(parseWhen("2026-11-18T09:00-0500")).toBe("2026-11-18T14:00:00.000Z");
    expect(parseWhen("2026-11-18T09:00+02:00")).toBe("2026-11-18T07:00:00.000Z");
  });
  it("rejects what is not a date", () => {
    for (const s of ["", "mañana", "2026-13-01", "2026-02-31", "2026-11-18T25:00", "18/11/2026"]) expect(parseWhen(s)).toBeNull();
  });
});

describe("labels", () => {
  const now = new Date("2026-11-16T15:00:00.000Z"); // Mon 10:00 Bogota
  it("says today and tomorrow", () => {
    expect(dueLabel("2026-11-16T20:00:00.000Z", now)).toBe("hoy 15:00");
    expect(dueLabel("2026-11-17T14:00:00.000Z", now)).toBe("mañana 9:00");
  });
  it("names the weekday and date further out", () => {
    expect(dueLabel("2026-11-18T14:00:00.000Z", now)).toBe("mié 18 nov 9:00");
    expect(returnsLabel("2026-11-18T14:00:00.000Z", now)).toBe("Vuelve mié 18 nov 9:00");
  });
  it("uses the Bogota day, not the UTC one", () => {
    expect(dueLabel("2026-11-17T03:00:00.000Z", now)).toBe("hoy 22:00");
  });
});
