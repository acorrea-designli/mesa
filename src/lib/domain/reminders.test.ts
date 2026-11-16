import { describe, expect, it } from "vitest";
import { autoReason, dueLabel, isAutoReason, parseWhen, returnsLabel } from "./reminders";

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
  it("rejects a day that does not exist even with a zone", () => {
    for (const s of ["2026-02-31T09:00Z", "2026-02-30T09:00-05:00", "2026-04-31 09:00+02:00", "2026-02-29T09:00:00Z"]) expect(parseWhen(s)).toBeNull();
    expect(parseWhen("2028-02-29T09:00Z")).toBe("2028-02-29T09:00:00.000Z"); // a leap day is real
  });
});

describe("auto reason", () => {
  const until = "2026-11-18T14:00:00.000Z";
  it("is only the exact text a date-only pause gets", () => {
    expect(autoReason(until)).toBe("Hasta mié 18 nov 9:00");
    expect(isAutoReason("Hasta mié 18 nov 9:00", until)).toBe(true);
    expect(isAutoReason("Hasta que Matt confirme", until)).toBe(false);
    expect(isAutoReason("Hasta mié 18 nov 9:00", null)).toBe(false);
    expect(isAutoReason(null, until)).toBe(false);
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
