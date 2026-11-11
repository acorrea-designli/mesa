import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { scanOnce } from "./notifier";
import type { Sender } from "./send";

// Meeting reminders by push (t112, decision 6C): the one push that carries the meeting's title.
const at = (hm: string) => Date.parse(`2026-11-11T${hm}:00-05:00`);
const SECRET_TICKET = "Cancela el mensaje a Matt sobre la tarifa de Freightmate";

let r: Repos;
let sent: string[];
let sender: Sender;
let looking = false;
const deps = () => ({ repos: r, sender, looking: { isLooking: () => looking } });
const payloads = () => sent.map((b) => JSON.parse(b) as { title: string; url: string; tag: string; body?: string });

const meeting = (o: { uid: string; start: string; end: string; title?: string; response?: "accepted" | "declined"; meetUrl?: string | null; allDay?: boolean; sample?: boolean }) => {
  const e = { uid: o.uid, occurrenceKey: new Date(at(o.start)).toISOString(), title: o.title ?? "Revisión de onboarding Bseen", startsAt: new Date(at(o.start)).toISOString(), endsAt: new Date(at(o.end)).toISOString(), allDay: o.allDay ?? false, timeZone: null, location: null, meetUrl: o.meetUrl === undefined ? "https://meet.google.com/abc-defg-hij" : o.meetUrl, attendees: [], organizer: null, response: o.response ?? "accepted", status: "confirmed" as const, recurring: false };
  if (o.sample) r.calendar.replaceSamples([e], new Date(at("14:00")));
  else r.calendar.replace([...r.calendar.list({ from: new Date(0), to: new Date("2100-01-01") }).filter((x) => !x.isSample).map((x) => ({ ...x, occurrenceKey: x.startsAt, attendees: x.attendees })), e], new Date(at("14:00")));
};

beforeEach(async () => {
  r = createRepos(openDb(":memory:"));
  sent = [];
  looking = false;
  sender = async (_sub, body) => {
    sent.push(body);
    return { ok: true };
  };
  r.push.upsert({ endpoint: "https://push.example/phone", p256dh: "k", auth: "a" });
  await scanOnce(deps(), at("14:30")); // the baseline
  sent.length = 0;
});

describe("push of a meeting reminder", () => {
  it("sends the title and the Meet link ten minutes before, under its own tag", async () => {
    meeting({ uid: "onb", start: "15:00", end: "15:30" });
    const res = await scanOnce(deps(), at("14:50"));
    expect(res.shown).toBe(1);
    expect(payloads()).toEqual([{ title: "Reunión en 10 min · 15:00", url: "https://meet.google.com/abc-defg-hij", tag: expect.stringMatching(/^meeting:ce_/), body: "Revisión de onboarding Bseen" }]);
  });

  it("does not send before the window, and sends only once per start", async () => {
    meeting({ uid: "onb", start: "15:00", end: "15:30" });
    await scanOnce(deps(), at("14:45"));
    expect(sent).toHaveLength(0);
    await scanOnce(deps(), at("14:50"));
    await scanOnce(deps(), at("14:55"));
    expect(sent).toHaveLength(1);
  });

  it("ignores the quiet rule: it is sent even while a Mesa tab is looking", async () => {
    looking = true;
    meeting({ uid: "onb", start: "15:00", end: "15:30" });
    const res = await scanOnce(deps(), at("14:51"));
    expect(res.quiet).toBe(true);
    expect(res.shown).toBe(1);
  });

  it("a moved meeting is a new key and sends again", async () => {
    meeting({ uid: "onb", start: "15:00", end: "15:30" });
    await scanOnce(deps(), at("14:50"));
    r.calendar.replace([], new Date(at("14:52")));
    meeting({ uid: "onb", start: "16:00", end: "16:30" });
    await scanOnce(deps(), at("15:52"));
    expect(payloads().map((p) => p.title)).toEqual(["Reunión en 10 min · 15:00", "Reunión en 8 min · 16:00"]);
  });

  it("falls back to the event in Mesa without a Meet link", async () => {
    meeting({ uid: "onb", start: "15:00", end: "15:30", meetUrl: null });
    await scanOnce(deps(), at("14:50"));
    expect(payloads()[0]!.url).toBe("/calendario?dia=2026-11-11");
  });

  it("skips declined meetings, all-day events and sample data", async () => {
    meeting({ uid: "d", start: "15:00", end: "15:30", response: "declined" });
    meeting({ uid: "a", start: "15:00", end: "15:30", allDay: true });
    meeting({ uid: "s", start: "15:00", end: "15:30", sample: true });
    const res = await scanOnce(deps(), at("14:50"));
    expect(res.shown).toBe(0);
  });

  it("every other push still carries no title or text", async () => {
    r.tickets.create({ direction: "claude_asks", title: SECRET_TICKET, body: "texto privado", ownerSession: "lead" }, new Date(at("14:35")));
    await scanOnce(deps(), at("14:36"));
    const p = payloads();
    expect(p).toHaveLength(1);
    expect(p[0]).not.toHaveProperty("body");
    expect(sent[0]).not.toContain("Freightmate");
  });
});
