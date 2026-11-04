import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/sqlite";
import { STATIONS, SOURCES } from "../domain/types";
import { createRepos, type Repos } from "../repo";
import { resetSamples, SAMPLE_SESSION, sampleCounts, seedSamples } from "./sample";

const NOW = new Date("2026-11-03T15:42:00.000Z");

let r: Repos;
let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  r = createRepos(db);
});

type Row = Record<string, string | number | null>;
const all = (sql: string, ...args: string[]) => db.prepare(sql).all(...args) as Row[];
const count = (sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const groups = (sql: string) => Object.fromEntries(all(sql).map((x) => [String(x.k), Number(x.n)]));

describe("seedSamples", () => {
  beforeEach(() => {
    seedSamples(r, NOW);
  });

  it("covers every station on items and tasks, with all four sources each", () => {
    for (const table of ["items", "tasks"]) {
      for (const station of STATIONS) {
        const sources = all(`SELECT DISTINCT source FROM ${table} WHERE station = ? AND is_sample = 1`, station).map((x) => x.source);
        expect(sources.sort(), `${table} ${station}`).toEqual([...SOURCES].sort());
      }
    }
  });

  it("links items from two sources to one task (interchange)", () => {
    const linked = all(
      "SELECT task_id, COUNT(DISTINCT source) AS n FROM items WHERE task_id IS NOT NULL GROUP BY task_id HAVING n >= 2",
    );
    expect(linked.length).toBeGreaterThanOrEqual(2);
  });

  it("sets sync states without real GitHub ids", () => {
    expect(groups("SELECT sync_state AS k, COUNT(*) AS n FROM tasks GROUP BY sync_state")).toMatchObject({
      synced: expect.any(Number),
      pending: expect.any(Number),
      error: 1,
    });
    expect(count("SELECT COUNT(*) AS n FROM tasks WHERE gh_item_id IS NOT NULL AND gh_item_id NOT LIKE 'SAMPLE_%'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM tasks WHERE sync_state = 'error' AND sync_error IS NULL")).toBe(0);
  });

  it("covers both ticket directions and every status", () => {
    expect(groups("SELECT direction AS k, COUNT(*) AS n FROM tickets GROUP BY direction")).toMatchObject({
      claude_asks: expect.any(Number),
      andres_asks: expect.any(Number),
    });
    const st = groups("SELECT status AS k, COUNT(*) AS n FROM tickets GROUP BY status");
    expect(Object.keys(st).sort()).toEqual(["closed", "waiting_andres", "waiting_claude", "working"]);
    expect(count("SELECT COUNT(*) AS n FROM tickets WHERE status = 'working' AND woke_at IS NOT NULL")).toBeGreaterThan(0);
    // An open A/B question with a recommendation.
    expect(
      count(
        `SELECT COUNT(*) AS n FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id
         WHERE t.status = 'waiting_andres' AND m.options IS NOT NULL AND m.recommended IS NOT NULL AND m.recommendation IS NOT NULL`,
      ),
    ).toBeGreaterThan(0);
    // A plan with direct and needs_ok actions waiting for the OK.
    expect(
      groups(
        `SELECT a.mode AS k, COUNT(*) AS n FROM planned_actions a JOIN tickets t ON t.id = a.ticket_id
         WHERE t.status = 'waiting_andres' GROUP BY a.mode`,
      ),
    ).toMatchObject({ direct: expect.any(Number), needs_ok: expect.any(Number) });
    expect(groups("SELECT ref_type AS k, COUNT(*) AS n FROM ticket_refs GROUP BY ref_type")).toMatchObject({
      ticket: expect.any(Number),
      url: expect.any(Number),
    });
    expect(count("SELECT MAX(c) AS n FROM (SELECT COUNT(*) AS c FROM ticket_messages GROUP BY ticket_id)")).toBeGreaterThanOrEqual(4);
  });

  it("covers every salida status and sent destination kind", () => {
    const st = groups("SELECT status AS k, COUNT(*) AS n FROM salidas GROUP BY status");
    for (const s of ["pending", "scheduled", "sending", "sent", "deleted", "failed", "denied", "expired", "queued_until_back"]) {
      expect(st[s], s).toBeGreaterThan(0);
    }
    const sentKinds = all(
      "SELECT DISTINCT json_extract(destination, '$.kind') AS k FROM salidas WHERE status IN ('sent','deleted') AND permalink IS NOT NULL",
    ).map((x) => x.k);
    expect(sentKinds.sort()).toEqual(["basecamp_campfire", "basecamp_comment", "github_comment", "github_review", "slack_thread"]);
    // The approve review went out with an empty body.
    expect(
      count(
        `SELECT COUNT(*) AS n FROM salidas s JOIN salida_versions v ON v.salida_id = s.id AND v.n = s.approved_version
         WHERE s.status = 'sent' AND json_extract(s.destination, '$.event') = 'APPROVE' AND v.body = ''`,
      ),
    ).toBe(1);
    // Inside the undo window at seed time.
    expect(count("SELECT COUNT(*) AS n FROM salidas WHERE status = 'sending' AND released_at IS NULL AND undo_until > ?", NOW.toISOString())).toBeGreaterThan(0);
    // Bounced: pending with the reason.
    expect(count("SELECT COUNT(*) AS n FROM salidas WHERE status = 'pending' AND error IS NOT NULL")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM salidas WHERE status = 'deleted' AND deleted_at IS NOT NULL")).toBe(1);
  });

  it("has a salida with many versions, stars, marks and an open refine turn elsewhere", () => {
    const top = all("SELECT salida_id AS id, COUNT(*) AS n FROM salida_versions GROUP BY salida_id ORDER BY n DESC LIMIT 1")[0];
    expect(Number(top?.n)).toBeGreaterThan(8);
    const id = String(top?.id);
    const d = r.salidas.detail(id);
    expect(d.status).toBe("pending");
    expect(d.versions.filter((v) => v.starred).length).toBeGreaterThanOrEqual(2);
    const marked = d.turns.find((t) => t.marks.length > 0);
    expect(new Set(marked?.marks.map((m) => m.kind))).toEqual(new Set(["keep", "redo", "drop"]));
    for (const m of marked?.marks ?? []) {
      const on = d.versions.find((v) => v.n === marked?.onVersion);
      expect(on?.body.slice(m.start, m.end)).toBe(m.text);
    }
    expect(count("SELECT COUNT(*) AS n FROM salida_turns WHERE author = 'andres' AND state = 'open'")).toBe(1);
  });

  it("covers chips, agents, approvals, reviews and engram", () => {
    expect(r.chips.top().length).toBeGreaterThan(0);
    expect(groups("SELECT status AS k, COUNT(*) AS n FROM ticket_handoffs GROUP BY status")).toMatchObject({
      done: expect.any(Number),
      paused: expect.any(Number),
      blocked: expect.any(Number),
    });
    expect(groups("SELECT status AS k, COUNT(*) AS n FROM ticket_team GROUP BY status")).toMatchObject({
      live: expect.any(Number),
      retired: expect.any(Number),
    });
    expect(count("SELECT COUNT(*) AS n FROM ticket_briefs")).toBeGreaterThan(0);

    expect(r.approvals.list({ status: "pending", hoy: true }, NOW)).toHaveLength(1);
    expect(count("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending' AND ticket_id IS NOT NULL")).toBe(1);
    expect(all("SELECT decision AS k FROM approvals WHERE status = 'decided'").map((x) => x.k).sort()).toEqual(["allow", "deny", "read_config"]);
    expect(count("SELECT COUNT(*) AS n FROM approvals WHERE status = 'expired'")).toBe(1);

    expect(all("SELECT DISTINCT state AS k FROM review_findings").map((x) => x.k).sort()).toEqual(["dismissed", "fixed", "open", "waived"]);
    expect(count("SELECT COUNT(*) AS n FROM review_findings WHERE state = 'open' AND label = 'blocker'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM review_findings WHERE state = 'open' AND label = 'nit'")).toBe(1);
    expect(all("SELECT state AS k FROM reviews").map((x) => x.k).sort()).toEqual(["approved", "approving", "open"]);

    expect(count("SELECT COUNT(*) AS n FROM engram_links WHERE entity_type = 'ticket'")).toBeGreaterThan(0);
  });

  it("flags every row as sample and leaves no wake events or listening session", () => {
    for (const t of ["items", "tasks", "tickets", "salidas", "approvals", "reviews", "learned_chips", "engram_links"]) {
      expect(count(`SELECT COUNT(*) AS n FROM ${t} WHERE is_sample = 0`), t).toBe(0);
    }
    expect(count("SELECT COUNT(*) AS n FROM wake_events")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM tickets WHERE owner_session IS NOT ? ", SAMPLE_SESSION)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM salidas WHERE owner_session IS NOT ?", SAMPLE_SESSION)).toBe(0);
    expect(r.sessions.isListening(r.sessions.get(SAMPLE_SESSION), NOW)).toBe(false);
  });

  it("does not duplicate when seeded twice", () => {
    const first = sampleCounts(db);
    const second = seedSamples(r, NOW);
    expect(second).toEqual(first);
    expect(count("SELECT COUNT(*) AS n FROM wake_events")).toBe(0);
  });
});

describe("resetSamples", () => {
  it("removes samples only and keeps real rows in the same tables", () => {
    const item = r.items.create({ source: "github", externalId: "pr:acme/real#1", kind: "pr_review", title: "real PR" }, NOW);
    const task = r.tasks.create({ title: "real task", source: "github", itemIds: [item.id] }, NOW);
    const ticket = r.tickets.create({ direction: "andres_asks", title: "real ticket", ownerSession: "lead", project: "scout" }, NOW);
    const salida = r.salidas.create(
      { source: "slack", destination: { kind: "slack_thread", workspace: "W", channel: "#real", postAs: "Andrés" }, body: "real", ownerSession: "lead" },
      NOW,
    );
    const approval = r.approvals.create({ agent: "lead", tool: "Bash", summary: "real", expiresAt: new Date(NOW.getTime() + 60_000).toISOString() }, NOW);
    r.reviews.upsertFinding(ticket.ref, { repo: "acme/real", pr: 1, label: "nit", summary: "real finding" }, NOW);
    r.chips.learn("Más corto", "acórtalo", NOW); // same label as a sample chip: the real one wins
    r.engram.link({ entityType: "ticket", entityId: ticket.id, project: "scout", topicKey: `mesa/${ticket.ref}` }, NOW);
    const realWakes = count("SELECT COUNT(*) AS n FROM wake_events");

    seedSamples(r, NOW);
    expect(r.chips.top().find((c) => c.label === "Más corto")?.uses).toBe(1);
    const removed = resetSamples(db);
    expect(removed.salidas).toBeGreaterThan(0);

    expect(r.items.get(item.id).title).toBe("real PR");
    expect(r.tasks.get(task.id).items?.map((x) => x.id)).toEqual([item.id]);
    expect(r.tickets.detail(ticket.id).messages).toHaveLength(1);
    expect(r.salidas.detail(salida.id).versions).toHaveLength(1);
    expect(r.approvals.get(approval.id, NOW).status).toBe("pending");
    expect(r.reviews.byPr("acme/real", 1).findings).toHaveLength(1);
    expect(r.chips.top().map((c) => c.label)).toEqual(["Más corto"]);
    expect(r.engram.list("ticket", ticket.id)).toHaveLength(1);
    expect(count("SELECT COUNT(*) AS n FROM wake_events")).toBe(realWakes);
    expect(r.sessions.find("lead")).not.toBeNull();
    expect(r.sessions.find(SAMPLE_SESSION)).toBeNull();

    for (const t of ["items", "tasks", "tickets", "salidas", "approvals", "reviews", "learned_chips", "engram_links"]) {
      expect(count(`SELECT COUNT(*) AS n FROM ${t} WHERE is_sample = 1`), t).toBe(0);
    }
    expect(count("SELECT COUNT(*) AS n FROM items")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM tasks")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM tickets")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM salidas")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM ticket_team")).toBe(0);
  });

  it("leaves a valid cold start (no chips) on an empty database", () => {
    seedSamples(r, NOW);
    resetSamples(db);
    expect(r.chips.top()).toEqual([]);
    expect(r.counts()).toMatchObject({ hoy: 0, tablero: 0, tickets: 0, salidas: 0, approvals: 0 });
  });
});
