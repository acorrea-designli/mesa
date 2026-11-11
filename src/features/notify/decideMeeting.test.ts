import { describe, expect, it } from "vitest";
import { meetingKey, remindersDue } from "@/lib/domain/calendar";
import type { CalendarEvent } from "@/lib/domain/types";
import { decide, meetingWaiting, meetLink, ticketWaiting, type Seen } from "./decide";

const at = (hm: string, day = "2026-11-11") => `${day}T${hm}:00-05:00`;
const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "ce_onb",
  uid: "onb",
  title: "Revisión de onboarding Bseen",
  startsAt: new Date(at("15:00")).toISOString(),
  endsAt: new Date(at("15:30")).toISOString(),
  allDay: false,
  timeZone: null,
  location: null,
  meetUrl: "https://meet.google.com/abc-defg-hij",
  attendees: [],
  attendeesCount: 4,
  organizer: null,
  response: "accepted",
  status: "confirmed",
  recurring: false,
  isSample: false,
  fetchedAt: "2026-11-11T19:00:00.000Z",
  ...over,
});
const NOW = new Date(at("14:50"));
const due = (e: CalendarEvent, now = NOW) => remindersDue([e], now).map((x) => meetingWaiting(x, now));
const run = (waiting: ReturnType<typeof due>, seen: Seen = {}, o: { quiet?: boolean; baseline?: boolean; now?: Date } = {}) => decide({ seen, waiting, now: (o.now ?? NOW).getTime(), quiet: o.quiet, baseline: o.baseline });

describe("meeting reminders (t112)", () => {
  it("shows the title and a Meet link ten minutes before", () => {
    const d = run(due(ev()));
    expect(d.show).toEqual([{ key: meetingKey(ev()), title: "Reunión en 10 min · 15:00", body: "Revisión de onboarding Bseen", url: "https://meet.google.com/abc-defg-hij", meeting: true }]);
  });

  it("opens the event in Mesa when there is no Meet, or a link that is not Google Meet", () => {
    expect(run(due(ev({ meetUrl: null }))).show[0]!.url).toBe("/calendario?dia=2026-11-11");
    expect(run(due(ev({ meetUrl: "https://zoom.example/j/1" }))).show[0]!.url).toBe("/calendario?dia=2026-11-11");
    expect(meetLink("https://meet.google.com/abc-defg-hij")).not.toBeNull();
    expect(meetLink("http://meet.google.com/abc")).toBeNull();
    expect(meetLink("https://meet.google.com.evil.example/abc")).toBeNull();
    expect(meetLink("javascript:alert(1)")).toBeNull();
  });

  it("counts the minutes left when a scan runs late", () => {
    expect(run(due(ev(), new Date(at("14:56"))), {}, { now: new Date(at("14:56")) }).show[0]!.title).toBe("Reunión en 4 min · 15:00");
  });

  it("ignores the quiet rule and the baseline: a meeting is news even while Mesa is focused", () => {
    expect(run(due(ev()), {}, { quiet: true }).show).toHaveLength(1);
    expect(run(due(ev()), {}, { baseline: true }).show).toHaveLength(1);
    // while a ticket in the same situation stays quiet
    const t = ticketWaiting({ id: "tk1", ref: "t1", title: "x", isSample: false });
    expect(decide({ seen: {}, waiting: [t], now: NOW.getTime(), quiet: true }).show).toHaveLength(0);
  });

  it("fires once per event start; a moved start fires again", () => {
    const first = run(due(ev()));
    const again = run(due(ev(), new Date(at("14:55"))), first.seen, { now: new Date(at("14:55")) });
    expect(again.show).toHaveLength(0);
    // moved to 16:00: its reminder window opens at 15:50, a new key
    const moved = ev({ startsAt: new Date(at("16:00")).toISOString(), endsAt: new Date(at("16:30")).toISOString() });
    const late = new Date(at("15:52"));
    const d = run(due(moved, late), first.seen, { now: late });
    expect(d.show.map((s) => s.title)).toEqual(["Reunión en 8 min · 16:00"]);
  });

  it("never reminds a declined meeting, an all-day event or sample data", () => {
    expect(due(ev({ response: "declined" }))).toHaveLength(0);
    expect(due(ev({ allDay: true }))).toHaveLength(0);
    const sample = run(due(ev({ isSample: true })));
    expect(sample.show).toHaveLength(0);
    expect(sample.seen).toEqual({}); // a sample is never remembered either
  });

  it("is remembered after it leaves the window, so a reload does not repeat it", () => {
    const first = run(due(ev()));
    const after = decide({ seen: first.seen, waiting: [], now: new Date(at("15:05")).getTime() });
    expect(Object.keys(after.seen)).toContain(meetingKey(ev()));
  });
});
