// t191: reminders and timed pauses. Repo level (create, list, cancel, done, fireDue, the timed pause and its auto-resume,
// survival of a restart), the HTTP routes, Hoy, and the push of a fired reminder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as TRANSITION } from "@/app/api/tickets/[id]/transition/route";
import { GET as LIST, POST as CREATE } from "@/app/api/reminders/route";
import { POST as CANCEL } from "@/app/api/reminders/[id]/cancel/route";
import { POST as DONE } from "@/app/api/reminders/[id]/done/route";
import { loadHoy } from "@/features/hoy/data";
import { ownerChip } from "@/features/tablero/model";
import { scanOnce } from "@/lib/push/notifier";
import type { Sender } from "@/lib/push/send";
import { openDb } from "../db/sqlite";
import { eventsAfter } from "../wake/wake";
import { createRepos, type Repos } from "./index";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
const T0 = new Date("2026-11-16T15:00:00.000Z"); // Mon 10:00 Bogota
const at = (ms: number) => new Date(T0.getTime() + ms);
const H = 3600_000;
const iso = (ms: number) => at(ms).toISOString();

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" }, T0);
});

const mk = (title = "Esperar al cliente") => r.tickets.create({ direction: "andres_asks", title, ownerSession: "lead" }, T0);
const wakes = (kind: string) => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === kind);
const post = (url: string, body: unknown) => new Request(`http://local${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("standalone reminders", () => {
  it("creates, lists, cancels and marks done", () => {
    const t = mk();
    const a = r.reminders.create({ text: "  Llamar a Matt ", dueAt: iso(2 * H), ticketRef: t.ref }, T0);
    expect(a).toMatchObject({ kind: "note", text: "Llamar a Matt", dueAt: iso(2 * H), ticketRef: t.ref, state: "pending", firedAt: null });
    const b = r.reminders.create({ text: "Revisar el PR", dueAt: iso(H) }, T0);
    expect(r.reminders.list().map((x) => x.id)).toEqual([b.id, a.id]); // soonest first

    expect(r.reminders.cancel(b.id, at(10)).state).toBe("cancelled");
    expect(() => r.reminders.cancel(b.id)).toThrow(/only a pending one/);
    expect(() => r.reminders.done(a.id)).toThrow(/already fired/);
    expect(r.reminders.list().map((x) => x.id)).toEqual([a.id]);
    expect(r.reminders.list({ all: true }).map((x) => x.state).sort()).toEqual(["cancelled", "pending"]);

    r.reminders.fireDue(at(3 * H));
    expect(r.reminders.done(a.id, at(3 * H)).state).toBe("done");
    expect(r.reminders.list()).toEqual([]);
  });

  it("refuses a bad text, a past date and an unknown ticket", () => {
    expect(() => r.reminders.create({ text: " ", dueAt: iso(H) }, T0)).toThrow(/needs a text/);
    expect(() => r.reminders.create({ text: "x".repeat(501), dueAt: iso(H) }, T0)).toThrow(/at most 500/);
    expect(() => r.reminders.create({ text: "x", dueAt: iso(-H) }, T0)).toThrow(/already past/);
    expect(() => r.reminders.create({ text: "x", dueAt: "nope" }, T0)).toThrow(/not a valid date/);
    expect(() => r.reminders.create({ text: "x", dueAt: iso(H), ticketRef: "t999" }, T0)).toThrow(/not found/);
  });

  it("fires once when its time comes, and never twice", () => {
    const a = r.reminders.create({ text: "Llamar", dueAt: iso(H) }, T0);
    expect(r.reminders.fireDue(at(H - 1))).toEqual({ notes: [], resumed: [] });
    const f = r.reminders.fireDue(at(H));
    expect(f.notes.map((x) => x.id)).toEqual([a.id]);
    expect(r.reminders.get(a.id)).toMatchObject({ state: "fired", firedAt: iso(H) });
    expect(r.reminders.fireDue(at(2 * H)).notes).toEqual([]);
    expect(() => r.reminders.cancel(a.id)).toThrow(/only a pending one/);
  });
});

describe("timed pause", () => {
  it("stores the date, reads 'Vuelve ...' and resumes by itself when it arrives", () => {
    const t = mk();
    const d = r.tickets.pause(t.ref, { kind: "paused", untilAt: iso(48 * H), by: "claude" }, T0);
    expect(d).toMatchObject({ status: "paused", pausedUntilAt: iso(48 * H), pauseReason: "Hasta mié 18 nov 10:00" });
    expect(ownerChip({ ticketId: t.id, ticketRef: t.ref, ticketStatus: "paused", pausedUntilAt: iso(48 * H), agent: null, role: null }, T0)?.label).toBe("En pausa · Vuelve mié 18 nov 10:00");

    r.sweep(at(47 * H));
    expect(r.tickets.get(t.ref).status).toBe("paused");
    expect(wakes("ticket.resumed")).toHaveLength(0);

    r.sweep(at(48 * H + 500));
    const after = r.tickets.detail(t.ref);
    expect(after).toMatchObject({ status: "waiting_claude", pausedUntilAt: null, pauseReason: null, pausedAt: null });
    expect(after.messages.at(-1)?.body).toBe("Llegó la fecha (mié 18 nov 10:00): vuelve a Claude");
    expect(wakes("ticket.resumed").map((e) => e.payload)).toEqual([{ ref: t.ref, ticketRef: t.ref, by: "date", until: iso(48 * H) }]);
    // a `resume` record carries the push, and a second sweep changes nothing
    expect(r.reminders.recentlyFired(at(48 * H + 600)).map((x) => ({ kind: x.kind, text: x.text, ticketRef: x.ticketRef }))).toEqual([{ kind: "resume", text: "Esperar al cliente", ticketRef: t.ref }]);
    r.sweep(at(49 * H));
    expect(wakes("ticket.resumed")).toHaveLength(1);
  });

  it("takes the reason from the date, but needs one without it", () => {
    const t = mk();
    expect(() => r.tickets.pause(t.ref, { kind: "paused", by: "claude" }, T0)).toThrow(/needs a reason/);
    expect(r.tickets.pause(t.ref, { kind: "paused", reason: "Espera a Matt", untilAt: iso(H), by: "claude" }, T0).pauseReason).toBe("Espera a Matt");
  });

  it("refuses a past or unreadable date, and a date on an ongoing ticket", () => {
    const t = mk();
    expect(() => r.tickets.pause(t.ref, { kind: "paused", untilAt: iso(-1), by: "claude" }, T0)).toThrow(/already past/);
    expect(() => r.tickets.pause(t.ref, { kind: "paused", untilAt: "nope", by: "claude" }, T0)).toThrow(/not a valid date/);
    expect(() => r.tickets.pause(t.ref, { kind: "ongoing", reason: "CI", untilAt: iso(H), by: "claude" }, T0)).toThrow(/only a paused ticket/);
  });

  it("does not resume a ticket that was resumed, closed or paused again for a later date", () => {
    const a = mk("A");
    const b = mk("B");
    const c = mk("C");
    r.tickets.pause(a.ref, { kind: "paused", untilAt: iso(H), by: "claude" }, T0);
    r.tickets.pause(b.ref, { kind: "paused", untilAt: iso(H), by: "claude" }, T0);
    r.tickets.pause(c.ref, { kind: "paused", untilAt: iso(H), by: "claude" }, T0);
    r.tickets.resume(a.ref, { by: "claude" }, at(10)); // back to work by hand: the date is gone
    r.tickets.transition(b.ref, { type: "close", by: "claude" }, undefined, at(20));
    r.tickets.pause(c.ref, { kind: "paused", untilAt: iso(5 * H), by: "claude" }, at(30)); // moved later
    r.sweep(at(2 * H));
    expect(r.tickets.get(a.ref).status).toBe("working");
    expect(r.tickets.get(b.ref).status).toBe("closed");
    expect(r.tickets.get(c.ref)).toMatchObject({ status: "paused", pausedUntilAt: iso(5 * H) });
    expect(wakes("ticket.resumed")).toHaveLength(0);
    r.sweep(at(5 * H));
    expect(r.tickets.get(c.ref).status).toBe("waiting_claude");
  });

  it("whichever comes first resumes a pause that also waits for a ticket", () => {
    const dep = mk("Dep");
    const t = mk("T");
    r.tickets.pause(t.ref, { kind: "paused", untilTicket: dep.ref, untilAt: iso(5 * H), by: "claude" }, T0);
    r.tickets.transition(dep.ref, { type: "close", by: "claude" }, undefined, at(H));
    expect(r.tickets.get(t.ref)).toMatchObject({ status: "waiting_claude", pausedUntilAt: null });
    expect(wakes("ticket.resumed").map((e) => (e.payload as { by: string }).by)).toEqual(["dependency"]);
    r.sweep(at(6 * H));
    expect(wakes("ticket.resumed")).toHaveLength(1); // the date finds nothing left to do
  });

  it("survives a restart: a date that passed while the server was down resumes on the first sweep", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-rem-"));
    const file = path.join(dir, "mesa.db");
    const db1 = openDb(file);
    const r1 = createRepos(db1);
    r1.sessions.touch({ id: "lead" }, T0);
    const t = r1.tickets.create({ direction: "andres_asks", title: "Espera", ownerSession: "lead" }, T0);
    r1.tickets.pause(t.id, { kind: "paused", untilAt: iso(H), by: "claude" }, T0);
    const rem = r1.reminders.create({ text: "Llamar", dueAt: iso(2 * H) }, T0);
    db1.close();

    const r2 = createRepos(openDb(file)); // the server restarts three hours later
    expect(r2.tickets.get(t.id)).toMatchObject({ status: "paused", pausedUntilAt: iso(H) });
    r2.sweep(at(3 * H));
    expect(r2.tickets.get(t.id).status).toBe("waiting_claude");
    expect(r2.reminders.get(rem.id).state).toBe("fired");
    expect(eventsAfter(r2.db, "lead", 0).filter((e) => e.kind === "ticket.resumed")).toHaveLength(1);
    r2.db.close();
  });
});

describe("api", () => {
  it("POST /api/tickets/:id/transition takes untilAt as Bogota time and answers 400 for a bad one", async () => {
    const t = mk();
    const send = (body: unknown) => TRANSITION(post(`/api/tickets/${t.id}/transition`, body), { params: Promise.resolve({ id: t.id }) });
    expect((await send({ event: "pause", by: "claude", untilAt: "nope" })).status).toBe(400);
    expect((await send({ event: "pause", by: "claude" })).status).toBe(400);
    expect((await send({ event: "ongoing", by: "claude", reason: "CI", untilAt: "2099-01-01" })).status).toBe(400);
    const ok = await send({ event: "pause", by: "claude", untilAt: "2099-01-02T09:00" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { pausedUntilAt: string }).pausedUntilAt).toBe("2099-01-02T14:00:00.000Z");
  });

  it("POST /api/reminders reads the date, GET lists, cancel and done answer 409 out of turn", async () => {
    const t = mk();
    expect((await CREATE(post("/api/reminders", { when: "mañana", text: "x" }), { params: Promise.resolve({}) })).status).toBe(400);
    expect((await CREATE(post("/api/reminders", { when: "2099-01-02", text: "x", ticket: "t999" }), { params: Promise.resolve({}) })).status).toBe(404);
    const res = await CREATE(post("/api/reminders", { when: "2099-01-02 09:00", text: "Llamar a Matt", ticket: t.ref }), { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
    const rem = (await res.json()) as { id: string; dueAt: string; ticketRef: string };
    expect(rem).toMatchObject({ dueAt: "2099-01-02T14:00:00.000Z", ticketRef: t.ref });

    const list = (await (await LIST(new Request("http://local/api/reminders"), { params: Promise.resolve({}) })).json()) as { reminders: { id: string }[] };
    expect(list.reminders.map((x) => x.id)).toEqual([rem.id]);
    const ctx = { params: Promise.resolve({ id: rem.id }) };
    expect((await DONE(post("/x", {}), ctx)).status).toBe(409);
    expect((await CANCEL(post("/x", {}), ctx)).status).toBe(200);
    expect((await CANCEL(post("/x", {}), ctx)).status).toBe(409);
    expect((await CANCEL(post("/x", {}), { params: Promise.resolve({ id: "rm_nope" }) })).status).toBe(404);
  });
});

describe("hoy", () => {
  it("lists open reminders with when they ring, and a fired one until it is done", () => {
    const t = mk();
    const a = r.reminders.create({ text: "Llamar a Matt", dueAt: iso(2 * H), ticketRef: t.ref }, T0);
    r.reminders.create({ text: "Revisar el PR", dueAt: iso(60 * H) }, T0);
    expect(loadHoy(at(0)).reminders).toEqual([
      { id: a.id, text: "Llamar a Matt", ticketRef: t.ref, when: "hoy 12:00", fired: false },
      expect.objectContaining({ text: "Revisar el PR", when: "mié 18 nov 22:00", fired: false }),
    ]);
    r.sweep(at(3 * H));
    expect(loadHoy(at(3 * H)).reminders[0]).toMatchObject({ id: a.id, fired: true });
    r.reminders.done(a.id, at(3 * H));
    expect(loadHoy(at(3 * H)).reminders.map((x) => x.id)).not.toContain(a.id);
  });
});

describe("push", () => {
  const payloads = (sent: string[]) => sent.map((b) => JSON.parse(b) as { title: string; url: string; tag: string; body?: string }).sort((a, b) => b.title.length - a.title.length); // same instant: the id decides the order
  let sent: string[];
  let looking = false;
  const sender: Sender = async (_sub, body) => {
    sent.push(body);
    return { ok: true };
  };
  const deps = () => ({ repos: r, sender, looking: { isLooking: () => looking } });

  beforeEach(async () => {
    sent = [];
    looking = false;
    r.push.upsert({ endpoint: "https://push.example/phone", p256dh: "k", auth: "a" });
    await scanOnce(deps(), T0.getTime()); // the baseline
    sent.length = 0;
  });

  it("pushes a fired standalone reminder with its text, once, even while a tab is looking", async () => {
    const t = mk();
    r.reminders.create({ text: "Llamar a Matt por la tarifa", dueAt: iso(H), ticketRef: t.ref }, T0);
    r.reminders.create({ text: "Sin ticket", dueAt: iso(H) }, T0);
    r.sweep(at(H));
    looking = true;
    const res = await scanOnce(deps(), at(H + 1000).getTime());
    expect(res.shown).toBe(2);
    expect(payloads(sent)).toEqual([
      { title: `Recordatorio · ${t.ref}`, url: `/tickets?t=${t.ref}`, tag: expect.stringMatching(/^reminder:rm_/), body: "Llamar a Matt por la tarifa" },
      { title: "Recordatorio", url: "/", tag: expect.stringMatching(/^reminder:rm_/), body: "Sin ticket" },
    ]);
    sent.length = 0;
    await scanOnce(deps(), at(H + 40_000).getTime());
    expect(sent).toHaveLength(0);
  });

  it("pushes 'Vuelve · tN' with the ticket's title when a timed pause ends", async () => {
    const t = mk("Esperar la vista de PDF");
    r.tickets.pause(t.ref, { kind: "paused", untilAt: iso(H), by: "claude" }, T0);
    await scanOnce(deps(), at(H - 1000).getTime());
    expect(sent).toHaveLength(0); // nothing before the date
    r.sweep(at(H));
    await scanOnce(deps(), at(H + 1000).getTime());
    expect(payloads(sent)).toEqual([{ title: `Vuelve · ${t.ref}`, url: `/tickets?t=${t.ref}`, tag: expect.stringMatching(/^reminder:rm_/), body: "Esperar la vista de PDF" }]);
  });

  it("does not push a reminder that was done before the scan, nor a cancelled one", async () => {
    const a = r.reminders.create({ text: "a", dueAt: iso(H) }, T0);
    const b = r.reminders.create({ text: "b", dueAt: iso(H) }, T0);
    r.reminders.cancel(b.id, at(10));
    r.sweep(at(H));
    r.reminders.done(a.id, at(H));
    await scanOnce(deps(), at(H + 1000).getTime());
    expect(sent).toHaveLength(0);
  });
});
