import { describe, expect, it } from "vitest";
import { openDb } from "./sqlite";

describe("1140_reminders migration", () => {
  it("adds the return date to tickets and the reminders table with its checks", () => {
    const db = openDb(":memory:");
    expect(db.prepare("SELECT name FROM schema_migrations WHERE name = '1140_reminders.sql'").all()).toHaveLength(1);
    db.prepare("INSERT INTO tickets (id, ref, direction, title, status, created_at, updated_at, paused_until_at) VALUES ('tk_1', 't1', 'andres_asks', 'x', 'paused', 'x', 'x', '2026-11-18T14:00:00.000Z')").run();
    expect((db.prepare("SELECT paused_until_at AS u FROM tickets WHERE id = 'tk_1'").get() as { u: string }).u).toBe("2026-11-18T14:00:00.000Z");

    const ins = (kind: string, state: string) => db.prepare("INSERT INTO reminders (id, kind, text, due_at, state, created_at) VALUES (?, ?, 'x', 'x', ?, 'x')").run(`rm_${kind}_${state}`, kind, state);
    ins("note", "pending");
    ins("resume", "fired");
    expect(() => ins("other", "pending")).toThrow(/CHECK/);
    expect(() => ins("note", "nope")).toThrow(/CHECK/);
  });
});
