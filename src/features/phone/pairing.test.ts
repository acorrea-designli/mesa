import { describe, expect, it } from "vitest";
import { timeLeft } from "./pairing";

describe("timeLeft", () => {
  const exp = "2026-11-09T12:10:00.000Z";
  const at = (iso: string) => Date.parse(iso);
  it("counts down in m:ss and ends at null", () => {
    expect(timeLeft(exp, at("2026-11-09T12:00:00Z"))).toBe("10:00");
    expect(timeLeft(exp, at("2026-11-09T12:00:19Z"))).toBe("9:41");
    expect(timeLeft(exp, at("2026-11-09T12:09:59.5Z"))).toBe("0:01");
    expect(timeLeft(exp, at("2026-11-09T12:10:00Z"))).toBeNull();
    expect(timeLeft(exp, at("2026-11-09T12:30:00Z"))).toBeNull();
    expect(timeLeft("junk", 0)).toBeNull();
  });
});
