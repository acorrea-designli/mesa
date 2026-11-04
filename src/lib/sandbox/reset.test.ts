// pnpm sandbox:reset against a temp "live" database: the source is never written (bytes and
// mtime unchanged, even with a live writer connection open in WAL mode) and the copy is scrubbed.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { emitWake } from "../wake/wake";
import { readSandboxCopy } from "./copy";
import { resetSandbox } from "./reset";

let dir: string;
let live: string;
let target: string;
let liveDb: Db | null = null;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-sandbox-"));
  live = path.join(dir, "mesa.db");
  target = path.join(dir, "sandbox.db");
});
afterEach(() => {
  liveDb?.close();
  liveDb = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

const DEST = { kind: "slack_channel", workspace: "designli", channel: "#pruebas", postAs: "Andrés" } as const;

/** A live board with everything the scrub must neutralise. */
function fillLive(r: Repos) {
  const now = new Date();
  r.sessions.touch({ id: "lead", label: "lead" }, now);
  const t = r.tickets.create({ direction: "andres_asks", title: "Revisar infra", ownerSession: "lead", body: "¿Puedes?" }, now);
  r.agents.addAgent({ ticket: t.ref, name: `tl-${t.ref}`, role: "tl", owner: true }, now);
  r.approvals.create({ ticketRef: t.ref, agent: `tl-${t.ref}`, tool: "Bash", summary: "whoami" }, now);

  const mk = (body: string) => r.salidas.create({ source: "slack", destination: DEST, body, ownerSession: "lead", ticketId: t.id }, now).id;
  const pending = mk("pendiente");
  const approved = mk("aprobada");
  r.salidas.transition(approved, { type: "approve", version: 1 }, now);
  const released = mk("liberada");
  r.salidas.transition(released, { type: "approve", version: 1 }, new Date(now.getTime() - 30_000));
  r.salidas.sweep(now);
  const scheduled = mk("programada");
  r.salidas.transition(scheduled, { type: "schedule", at: new Date(now.getTime() + 3600_000).toISOString(), version: 1 }, now);
  const sent = mk("enviada");
  r.salidas.transition(sent, { type: "approve", version: 1 }, new Date(now.getTime() - 30_000));
  r.salidas.sweep(now);
  r.salidas.transition(sent, { type: "sent", permalink: "https://designli.slack.com/archives/C1/p1" }, now);

  const task = r.tasks.create({ title: "PR 12", source: "github" }, now);
  r.tasks.markSync(task.id, { syncState: "synced", ghItemId: "PVTI_real" }, now);
  r.db.prepare("INSERT INTO settings (key, value) VALUES ('gh_project.id', '\"PVT_real\"'), ('gh_project.url', '\"https://github.com/x\"')").run();
  emitWake(r.db, { sessionId: "lead", kind: "ticket.created", entityType: "ticket", entityId: t.id, payload: {} }, now);
  // A card handed to Claude on the live board: linked ticket both ways, ticket.created wake to the lead.
  const card = r.tasks.create({ title: "Revisar backups", source: "claude" }, now);
  const dispatched = r.dispatch.dispatch(card.id, {}, now);
  return { ticket: t, pending, approved, released, scheduled, sent, task: task.id, card: card.id, dispatched: dispatched.ticket };
}

const fingerprint = (f: string) => ({ sha: createHash("sha256").update(fs.readFileSync(f)).digest("hex"), mtime: fs.statSync(f).mtimeMs, size: fs.statSync(f).size });

describe("resetSandbox --from live", () => {
  it("copies a running live board without writing to it, and scrubs the copy", () => {
    liveDb = openDb(live); // WAL, kept open like the live server's connection
    const ids = fillLive(createRepos(liveDb));
    const before = { main: fingerprint(live), wal: fingerprint(`${live}-wal`) };

    const copy = resetSandbox({ from: "live", source: live, target });

    expect(fingerprint(live)).toEqual(before.main);
    expect(fingerprint(`${live}-wal`)).toEqual(before.wal);
    // The live connection still writes (the copy took no lasting lock).
    createRepos(liveDb).tasks.create({ title: "después", source: "claude" });

    expect(copy).toMatchObject({ from: "live", source: path.resolve(live) });
    expect(copy.rows.salidas).toBe(5);
    const db = openDb(target);
    try {
      const r = createRepos(db);
      expect(readSandboxCopy(db)).toMatchObject({ from: "live" });
      expect(db.prepare("SELECT COUNT(*) AS n FROM wake_events").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
      expect(r.tickets.detail(ids.ticket.id).ownerSession).toBeNull();
      expect(r.agents.team({ status: "live" })).toEqual([]);
      expect(r.approvals.list({ status: "pending" })).toEqual([]);
      for (const id of [ids.pending, ids.approved, ids.released, ids.scheduled]) {
        expect(r.salidas.get(id)).toMatchObject({ status: "pending", approvedVersion: null, undoUntil: null, releasedAt: null, sendAt: null, ownerSession: null });
      }
      // Already sent salidas stay sent with their real link (the sandbox refuses to delete those).
      expect(r.salidas.get(ids.sent)).toMatchObject({ status: "sent", permalink: "https://designli.slack.com/archives/C1/p1" });
      expect(r.tasks.list().find((t) => t.id === ids.task)).toMatchObject({ ghItemId: null, syncState: "local" });
      expect(r.tasks.pendingSync()).toEqual([]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'gh_project.%'").get()).toEqual({ n: 0 });
      expect(r.tasks.list().some((t) => t.title === "después")).toBe(false);
      // Task <-> ticket links survive the copy; the live dispatch's wake does not.
      expect(r.tasks.get(ids.card).ticketId).toBe(ids.dispatched.id);
      expect(r.tickets.detail(ids.dispatched.id)).toMatchObject({ taskId: ids.card, ownerSession: null });
      // Dispatch works on the sandbox: a new card gets its ticket and one ticket.created wake to the lead.
      const fresh = r.tasks.create({ title: "Probar el flujo", source: "claude" });
      const d = r.dispatch.dispatch(fresh.id);
      expect(d.created).toBe(true);
      expect(db.prepare("SELECT session_id, kind, entity_id FROM wake_events").all()).toEqual([{ session_id: "lead", kind: "ticket.created", entity_id: d.ticket.id }]);
      // Re-dispatching the copied card is idempotent (its ticket is still open): no second wake.
      expect(r.dispatch.dispatch(ids.card).created).toBe(false);
      expect(db.prepare("SELECT COUNT(*) AS n FROM wake_events").get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it("copies a live file with no open connection (no -wal) and still leaves it untouched", () => {
    const db = openDb(live);
    fillLive(createRepos(db));
    db.close();
    const before = fingerprint(live);
    resetSandbox({ from: "live", source: live, target });
    expect(fingerprint(live)).toEqual(before);
    // No stray -wal/-shm left next to a stopped live board.
    expect(fs.existsSync(`${live}-wal`)).toBe(false);
    expect(fs.existsSync(`${live}-shm`)).toBe(false);
  });

  it("replaces an existing sandbox and refuses to write over the live board", () => {
    const db = openDb(live);
    fillLive(createRepos(db));
    db.close();
    fs.writeFileSync(target, "old");
    resetSandbox({ from: "live", source: live, target });
    const t = openDb(target);
    expect(readSandboxCopy(t)).not.toBeNull();
    t.close();
    expect(() => resetSandbox({ from: "live", source: live, target: live })).toThrow(/refusing/);
    expect(() => resetSandbox({ from: "seed", target: path.join(dir, "data", "mesa.db") })).toThrow(/live board/);
    expect(() => resetSandbox({ from: "live", source: path.join(dir, "missing.db"), target })).toThrow(/not found/);
  });
});

describe("resetSandbox --from seed", () => {
  it("seeds ordinary rows whose salidas run the full flow", () => {
    const copy = resetSandbox({ from: "seed", target });
    expect(copy.from).toBe("seed");
    expect(copy.scrubbed.samplesUnflagged).toBeGreaterThan(0);
    const db = openDb(target);
    try {
      const r = createRepos(db);
      expect(db.prepare("SELECT COUNT(*) AS n FROM salidas WHERE is_sample = 1").get()).toEqual({ n: 0 });
      const pending = r.salidas.list({ status: ["pending"] })[0];
      expect(pending).toBeDefined();
      const t0 = new Date();
      r.salidas.transition(pending!.id, { type: "approve", version: pending!.currentVersion }, t0);
      r.salidas.sweep(new Date(t0.getTime() + 21_000));
      expect(r.salidas.get(pending!.id).releasedAt).not.toBeNull();
    } finally {
      db.close();
    }
  });
});
