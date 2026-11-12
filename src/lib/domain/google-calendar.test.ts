import { describe, expect, it } from "vitest";
import { coverageOf, STORED_AHEAD_DAYS, STORED_BACK_DAYS, storedWindow } from "./calendar";
import { googleDayUrl, googleEid, googleEventUrl, googleWeekUrl } from "./google-calendar";

// A placeholder owner: no test carries a real address.
const CAL = "owner@example.com";
const b64 = (s: string) => Buffer.from(s).toString("base64").replace(/=+$/, "");
const url = (eid: string) => `https://www.google.com/calendar/event?eid=${eid}`;
const DAY_12 = "https://calendar.google.com/calendar/r/day/2026/11/12";

const ev = (o: Partial<Parameters<typeof googleEventUrl>[0]> = {}) => ({
  uid: "03fo5onsmpno60suu57ma2ashp@google.com",
  occurrenceKey: "2026-11-12T16:00:00.000Z",
  allDay: false,
  recurring: false,
  startsAt: "2026-11-12T16:00:00.000Z",
  ...o,
});

describe("googleEventUrl", () => {
  it("a single event is its plain id", () => {
    expect(googleEventUrl(ev(), CAL)).toBe(url(b64(`03fo5onsmpno60suu57ma2ashp ${CAL}`)));
    expect(googleEid(ev(), CAL)).not.toContain("=");
  });

  it("a timed series occurrence is the series id plus the original start in UTC", () => {
    const e = ev({ uid: "abcdef0123@google.com", recurring: true, occurrenceKey: "2026-11-12T16:00:00.000Z" });
    expect(googleEventUrl(e, CAL)).toBe(url(b64(`abcdef0123_20261112T160000Z ${CAL}`)));
  });

  it("an all-day series occurrence is the series id plus the date (Bogota)", () => {
    // Bogota midnight of 12 Nov is 05:00 UTC.
    const e = ev({ uid: "allday1@google.com", recurring: true, allDay: true, occurrenceKey: "2026-11-12T05:00:00.000Z", startsAt: "2026-11-12T05:00:00.000Z" });
    expect(googleEventUrl(e, CAL)).toBe(url(b64(`allday1_20261112 ${CAL}`)));
  });

  it("a split series (_R...) keeps its whole id before the instance suffix", () => {
    const e = ev({ uid: "abc_R20261001T150000@google.com", recurring: true });
    expect(googleEventUrl(e, CAL)).toBe(url(b64(`abc_R20261001T150000_20261112T160000Z ${CAL}`)));
  });

  it("a moved occurrence uses the original start (the key), not where it landed", () => {
    const e = ev({ uid: "moved1@google.com", recurring: true, occurrenceKey: "2026-11-12T16:00:00.000Z", startsAt: "2026-11-13T18:30:00.000Z" });
    expect(googleEventUrl(e, CAL)).toBe(url(b64(`moved1_20261112T160000Z ${CAL}`)));
  });

  it("a UID that is not Google's opens the event's day", () => {
    expect(googleEventUrl(ev({ uid: "x1@example.org" }), CAL)).toBe(DAY_12);
    expect(googleEventUrl(ev({ uid: "plain" }), CAL)).toBe(DAY_12);
  });

  it("without a calendar id it opens the day (Bogota, not UTC)", () => {
    const late = ev({ startsAt: "2026-11-13T03:30:00.000Z" }); // 22:30 on the 12th in Bogota
    expect(googleEventUrl(late, null)).toBe(DAY_12);
    expect(googleEventUrl(late, "  ")).toBe(DAY_12);
    expect(googleEventUrl(late, "not-an-address")).toBe(DAY_12);
  });

  it("an unreadable key falls back to the day", () => {
    expect(googleEventUrl(ev({ recurring: true, occurrenceKey: "garbage" }), CAL)).toBe(DAY_12);
  });
});

describe("Google day and week URLs", () => {
  it("do not pad the month or the day and cross a year", () => {
    expect(googleDayUrl("2026-01-05")).toBe("https://calendar.google.com/calendar/r/day/2026/1/5");
    expect(googleWeekUrl("2026-12-28")).toBe("https://calendar.google.com/calendar/r/week/2026/12/28");
    expect(googleWeekUrl("2027-01-04")).toBe("https://calendar.google.com/calendar/r/week/2027/1/4");
  });
});

describe("the stored window", () => {
  it("is 13 weeks back and 26 ahead", () => {
    expect([STORED_BACK_DAYS, STORED_AHEAD_DAYS]).toEqual([91, 182]);
    expect(storedWindow("2026-11-12")).toEqual({ fromDay: "2026-08-13", toDay: "2027-05-13" });
  });

  it("tells whole, partial and outside ranges apart", () => {
    const today = "2026-11-12";
    expect(coverageOf("2026-11-09", "2026-11-16", today)).toBe("in");
    expect(coverageOf("2026-08-10", "2026-08-17", today)).toBe("partial"); // starts before 13 Aug
    expect(coverageOf("2026-08-03", "2026-08-10", today)).toBe("out");
    expect(coverageOf("2027-05-10", "2027-05-17", today)).toBe("partial");
    expect(coverageOf("2027-05-17", "2027-05-24", today)).toBe("out");
  });
});
