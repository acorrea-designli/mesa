import { describe, expect, it } from "vitest";
import { usageView } from "@/lib/domain/usage";
import { meterLabel, tickLeft, tickPct, usedPct } from "./UsageMeter";

const NOW = new Date("2026-11-13T15:46:00Z"); // 10:46 Bogota
const sec = (iso: string) => Date.parse(iso) / 1000;
const view = usageView(
  {
    capturedAt: "2026-11-13T15:44:00Z",
    sessionId: "s",
    model: { id: "m", displayName: "M" },
    // The window 09:30-14:30 Bogota: 1 h 16 elapsed at 10:46.
    fiveHour: { usedPercentage: 35, resetsAt: sec("2026-11-13T19:30:00Z") },
    sevenDay: { usedPercentage: 19.6, resetsAt: sec("2026-11-16T19:00:00Z") },
  },
  NOW,
);
const five = view.windows[0]!;
const week = view.windows[1]!;
const none = usageView(null, NOW).windows[0]!;

describe("UsageMeter marks", () => {
  it("the fill is % used, whole", () => {
    expect(usedPct(five)).toBe(35);
    expect(usedPct(week)).toBe(20);
    expect(usedPct(none)).toBeNull();
  });

  it("the tick is the share of the window already elapsed, not 100 minus it", () => {
    expect(tickPct(five)).toBe(25.3);
    expect(tickPct(none)).toBeNull();
  });

  it("a tick at either end of the window stays inside the track", () => {
    expect(tickLeft(0)).toBe("clamp(2px, 0%, calc(100% - 2px))");
    expect(tickLeft(25.3)).toBe("clamp(2px, 25.3%, calc(100% - 2px))");
  });

  it("the accessible name reads used, elapsed time and reset", () => {
    expect(meterLabel(five)).toBe("5 h: 35% usado, tiempo 1 h 16 de 5 h, reinicia 14:30");
    expect(meterLabel(week)).toContain("semana: 20% usado, tiempo 3 d 20 h de 7 d, reinicia");
    expect(meterLabel(none)).toBe("5 h: sin dato");
  });
});
