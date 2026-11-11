// 0920_ticket_questions: the table, and the back-fill of every message that carried options as a 1-question card.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createRepos } from "../repo";
import { MIGRATIONS_DIR, migrate, openDb } from "./sqlite";

const MIGRATION = "0920_ticket_questions.sql";
const AB = JSON.stringify([
  { key: "A", label: "Sí" },
  { key: "B", label: "No" },
]);

/** A database migrated up to (not including) 0920, with old-style option messages in every situation. */
function legacyDb(file = ":memory:") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-tq-"));
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql") && n < MIGRATION)) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db, dir);
  const ticket = (id: string, status: string) =>
    db.prepare("INSERT INTO tickets (id, ref, direction, title, status, created_at, updated_at) VALUES (?, ?, 'claude_asks', ?, ?, 'x', 'x')").run(id, id, id, status);
  const msg = (id: string, ticketId: string, author: string, at: string, o: { body?: string; options?: string; recommended?: string; recommendation?: string; chosen?: string; kind?: string } = {}) =>
    db
      .prepare(
        "INSERT INTO ticket_messages (id, ticket_id, author, body, options, recommended, recommendation, chosen, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, ticketId, author, o.body ?? "", o.options ?? null, o.recommended ?? null, o.recommendation ?? null, o.chosen ?? null, o.kind ?? null, at);
  // t1: picked B by click; t2: answered in words, then a later question nobody answered (open);
  // t3: closed without an answer (withdrawn); t4: only a "Pídeme permiso" after it (still open); t5: no options at all.
  ticket("t1", "waiting_claude");
  msg("m1", "t1", "claude", "2026-11-01T10:00:00.000Z", { body: "¿Merge?", options: AB, recommended: "A", recommendation: "CI verde" });
  msg("m1a", "t1", "andres", "2026-11-01T10:05:00.000Z", { body: "B. No", chosen: "B" });
  ticket("t2", "waiting_andres");
  msg("m2", "t2", "claude", "2026-11-01T10:00:00.000Z", { body: "¿A o B?", options: AB });
  msg("m2a", "t2", "andres", "2026-11-01T10:01:00.000Z", { body: "ninguna, otra cosa" });
  msg("m2b", "t2", "andres", "2026-11-01T10:02:00.000Z", { body: "y otra" });
  msg("m2c", "t2", "claude", "2026-11-01T10:03:00.000Z", { body: "¿Y ahora?", options: AB, recommended: "B" });
  ticket("t3", "closed");
  msg("m3", "t3", "claude", "2026-11-01T10:00:00.000Z", { body: "¿Lo cierro?", options: AB });
  ticket("t4", "waiting_claude");
  msg("m4", "t4", "claude", "2026-11-01T10:00:00.000Z", { body: "¿Sigo?", options: AB });
  msg("m4p", "t4", "andres", "2026-11-01T10:01:00.000Z", { body: "Pídeme permiso", kind: "permission_request" });
  ticket("t5", "working");
  msg("m5", "t5", "claude", "2026-11-01T10:00:00.000Z", { body: "FYI: nada que elegir" });
  return db;
}

type Row = Record<string, unknown>;
const rows = (db: DatabaseSync) =>
  (db.prepare("SELECT * FROM ticket_questions ORDER BY ticket_id, created_at").all() as Row[]).map((r) => ({
    ticket: r.ticket_id,
    message: r.message_id,
    n: r.n,
    text: r.text,
    state: r.state,
    chosen: r.chosen,
    answerText: r.answer_text,
    answerMessage: r.answer_message_id,
    withdrawReason: r.withdraw_reason,
    recommended: r.recommended,
  }));

describe("0920_ticket_questions migration", () => {
  it("back-fills option messages as 1-question cards: answered when he wrote after, withdrawn on a closed ticket, else open", () => {
    const db = legacyDb();
    expect(migrate(db)[0]).toBe(MIGRATION);
    const base = { n: 1, text: "", chosen: null, answerText: null, answerMessage: null, withdrawReason: null, recommended: null };
    expect(rows(db)).toEqual([
      { ...base, ticket: "t1", message: "m1", state: "answered", chosen: "B", answerMessage: "m1a", recommended: "A" },
      { ...base, ticket: "t2", message: "m2", state: "answered", answerText: "ninguna, otra cosa", answerMessage: "m2a" },
      { ...base, ticket: "t2", message: "m2c", state: "open", recommended: "B" },
      { ...base, ticket: "t3", message: "m3", state: "withdrawn", withdrawReason: "Ticket cerrado sin respuesta" },
      { ...base, ticket: "t4", message: "m4", state: "open" },
    ]);
    const ids = (db.prepare("SELECT id FROM ticket_questions").all() as { id: string }[]).map((r) => r.id);
    expect(ids.every((id) => /^tq_[0-9a-f]{12}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("the repo reads the back-filled cards: the open one stays live and a typed key answers it", () => {
    const db = legacyDb();
    migrate(db);
    const r = createRepos(db);
    expect(r.tickets.detail("t2").questions.map((q) => [q.messageId, q.state])).toEqual([
      ["m2", "answered"],
      ["m2c", "open"],
    ]);
    expect(r.tickets.detail("t2").questions[1]!.options).toEqual(JSON.parse(AB));
    r.tickets.addMessage("t2", { author: "andres", body: "b" });
    expect(r.tickets.detail("t2").questions[1]).toMatchObject({ state: "answered", chosen: "B" });
  });

  it("applies on startup through openDb (what pnpm db:migrate runs) and is recorded once", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-tq-file-"));
    const file = path.join(dir, "mesa.db");
    legacyDb(file).close();
    const db = openDb(file);
    expect((db.prepare("SELECT COUNT(*) AS n FROM ticket_questions").get() as { n: number }).n).toBe(5);
    expect((db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE name = ?").get(MIGRATION) as { n: number }).n).toBe(1);
    db.close();
    const again = openDb(file);
    expect((again.prepare("SELECT COUNT(*) AS n FROM ticket_questions").get() as { n: number }).n).toBe(5);
    again.close();
  });
});
