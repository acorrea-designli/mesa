import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate, openDb } from "../db/sqlite";
import { NotFoundError } from "../db/util";
import { createRepos, type Repos } from "./index";

let r: Repos;
const T0 = new Date("2026-11-03T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
});

const claudeAsks = (title: string, when = T0) => r.tickets.create({ direction: "claude_asks", title, body: title, ownerSession: "lead" }, when);
const andresAsks = (title: string, when = T0) => r.tickets.create({ direction: "andres_asks", title, body: title, ownerSession: "lead" }, when);

describe("ticket read state", () => {
  it("a ticket Claude wrote is new until Andrés opens it; his own request never is", () => {
    const c = claudeAsks("Elige A o B");
    const mine = andresAsks("Revisa el PR");
    expect(r.tickets.unreadIds()).toEqual(new Set([c.id]));
    r.tickets.markSeen(c.ref, at(1000));
    expect(r.tickets.unreadIds().has(c.id)).toBe(false);
    expect(r.tickets.unreadIds().has(mine.id)).toBe(false);
  });

  it("a later message from Claude sets the flag again; his own message does not", () => {
    const t = claudeAsks("Elige A o B");
    r.tickets.markSeen(t.id, at(1000));
    r.tickets.addMessage(t.id, { author: "andres", body: "A" }, at(2000));
    expect(r.tickets.unreadIds().has(t.id)).toBe(false);
    r.tickets.addMessage(t.id, { author: "claude", body: "Hecho" }, at(3000));
    expect(r.tickets.unreadIds().has(t.id)).toBe(true);
    r.tickets.markSeen(t.id, at(4000));
    expect(r.tickets.unreadIds().has(t.id)).toBe(false);
  });

  it("tracks each ticket on its own", () => {
    const a = claudeAsks("A", at(1));
    const b = claudeAsks("B", at(2));
    r.tickets.markSeen(a.id, at(1000));
    expect(r.tickets.unreadIds()).toEqual(new Set([b.id]));
    r.tickets.addMessage(a.id, { author: "claude", body: "otra" }, at(2000));
    expect(r.tickets.unreadIds()).toEqual(new Set([a.id, b.id]));
  });

  it("seen-at only moves forward and markSeen resolves a ref or an id", () => {
    const t = claudeAsks("A");
    r.tickets.markSeen(t.ref, at(5000));
    const again = r.tickets.markSeen(t.id, at(1000));
    expect(again).toEqual({ ticketId: t.id, seenAt: at(5000).toISOString() });
    r.tickets.addMessage(t.id, { author: "claude", body: "x" }, at(3000));
    expect(r.tickets.unreadIds().has(t.id)).toBe(false); // older than what he saw
  });

  it("survives a reload: the state is in the database, not in memory", () => {
    const t = claudeAsks("A");
    r.tickets.markSeen(t.id, at(1000));
    const reloaded = createRepos(r.db);
    expect(reloaded.tickets.unreadIds().has(t.id)).toBe(false);
    reloaded.tickets.addMessage(t.id, { author: "claude", body: "x" }, at(2000));
    expect(createRepos(r.db).tickets.unreadIds().has(t.id)).toBe(true);
  });

  it("markSeen on an unknown ticket is a not-found", () => {
    expect(() => r.tickets.markSeen("t999")).toThrow(NotFoundError);
  });

  it("the read state goes with its ticket", () => {
    const t = claudeAsks("A");
    r.tickets.markSeen(t.id, at(1000));
    r.db.prepare("DELETE FROM tickets WHERE id = ?").run(t.id);
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM ticket_reads").get()).toEqual({ n: 0 });
  });

  it("tickets that exist when the migration runs start as seen", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-"));
    for (const f of fs.readdirSync(MIGRATIONS_DIR)) if (f !== "0610_ticket_reads.sql") fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    migrate(db, dir);
    const old = createRepos(db);
    const t = old.tickets.create({ direction: "claude_asks", title: "viejo", body: "viejo", ownerSession: "lead" }, new Date("2026-01-01T00:00:00.000Z"));
    expect(migrate(db)).toEqual(["0610_ticket_reads.sql"]);
    expect(old.tickets.unreadIds().has(t.id)).toBe(false);
    old.tickets.addMessage(t.id, { author: "claude", body: "nuevo" }, new Date(Date.now() + 5000));
    expect(old.tickets.unreadIds().has(t.id)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
