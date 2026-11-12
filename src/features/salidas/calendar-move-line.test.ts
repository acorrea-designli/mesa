import { describe, expect, it } from "vitest";
import { formatMoveBody } from "@/lib/domain/calendar-move";
import { calendarLine } from "./model";

describe("calendarLine for a move salida", () => {
  it("says what moves and where to, not Mover: <id>", () => {
    const body = formatMoveBody({ eventId: "03fo5onsmpno60suu57ma2ashp", title: "Weekly Check-In", start: "2026-11-13T11:00:00-05:00", end: "2026-11-13T11:30:00-05:00", timeZone: "America/Bogota", notify: true });
    const line = calendarLine(body);
    expect(line).toMatch(/^Mover · Weekly Check-In · viernes 13 nov · 11:00–11:30$/);
  });
});
