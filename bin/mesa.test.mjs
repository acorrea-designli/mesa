// CLI tests: run bin/mesa as a child process against a fake Mesa API and check the
// requests it makes (method, path, body), its output and its exit codes.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "mesa");

let server;
let base;
let requests = [];
let handler = () => ({ status: 200, body: {} });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const url = new URL(req.url, "http://x");
    const r = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: raw ? JSON.parse(raw) : undefined };
    requests.push(r);
    const out = (await handler(r)) ?? { status: 200, body: {} };
    res.writeHead(out.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(out.body ?? {}));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  requests = [];
  handler = () => ({ status: 200, body: {} });
});

function mesa(args, { env = {}, stdin } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, MESA_URL: base, MESA_SESSION: "lead", MESA_AGENT: "", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr, json: () => JSON.parse(stdout) }));
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

describe("mesa CLI", () => {
  it("documents every command in help", async () => {
    const r = await mesa(["help"]);
    expect(r.code).toBe(0);
    for (const c of [
      "mesa session",
      "mesa wait",
      "mesa ack",
      "mesa ticket ask",
      "--wait",
      "mesa ticket reply",
      "mesa ticket plan",
      "mesa ticket context",
      "mesa ticket brief",
      "mesa salida propose",
      "--wait-release",
      "mesa salida sent",
      "mesa salida hold",
      "mesa salida bounce",
      "mesa handoff",
      "mesa team add",
      "mesa finding upsert",
      "mesa review list",
      "mesa approval show",
      "mesa source get",
      "mesa source set",
      "mesa sweep",
      "mesa github sync",
      "mesa github status",
      "mesa github import-reviews",
      "mesa item upsert",
      "mesa ignore list",
      "mesa ignore add",
      "mesa ignore remove",
      "mesa engram link",
    ]) {
      expect(r.stdout).toContain(c);
    }
  });

  it("has no approve, schedule, deny or undo for salidas, and no approval decisions", async () => {
    for (const cmd of ["approve", "schedule", "deny", "undo", "unqueue"]) {
      const r = await mesa(["salida", cmd, "s1"]);
      expect(r.code).toBe(2);
    }
    expect((await mesa(["approval", "decide", "ap1"])).code).toBe(2);
    expect(requests).toEqual([]);
  });

  it("exits 2 with usage on missing arguments", async () => {
    const r = await mesa(["ticket", "ask"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/missing --title/);
  });

  it("parses repeated options, A/B options and stdin bodies for ticket ask", async () => {
    handler = () => ({ body: { id: "tk_1", ref: "t1", messages: [] } });
    const r = await mesa(
      ["ticket", "ask", "--title", "¿Bucket?", "--body", "-", "--option", "A:Nuevo", "--option", "B:Reusar:dre-staging-docs", "--recommend", "A", "--why", "aísla", "--ref", "t3"],
      { stdin: "Detalle\n" },
    );
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/api/tickets",
      body: {
        direction: "claude_asks",
        title: "¿Bucket?",
        body: "Detalle",
        options: [{ key: "A", label: "Nuevo" }, { key: "B", label: "Reusar", detail: "dre-staging-docs" }],
        recommended: "A",
        recommendation: "aísla",
        ownerSession: "lead",
        refs: [{ refType: "ticket", target: "t3" }],
      },
    });
    expect(r.json()).toMatchObject({ ref: "t1" });
  });

  it("ticket ask --wait peeks (never acks) until Andrés answers", async () => {
    let polls = 0;
    handler = (q) => {
      if (q.method === "POST" && q.path === "/api/tickets") return { body: { id: "tk_1", ref: "t1", status: "waiting_andres", createdAt: "2026-11-03T10:00:00.000Z", messages: [{ author: "claude", createdAt: "2026-11-03T10:00:00.000Z" }] } };
      if (q.path === "/api/wait") return { body: { events: [{ id: 7, kind: "ticket.answered", entityId: "tk_1" }], cursor: 7 } };
      if (q.path === "/api/tickets/tk_1") {
        polls++;
        const messages = [{ author: "claude", body: "?", createdAt: "2026-11-03T10:00:00.000Z" }];
        if (polls > 1) messages.push({ author: "andres", body: "Opción A", chosen: "A", createdAt: "2026-11-03T10:01:00.000Z" });
        return { body: { id: "tk_1", ref: "t1", status: polls > 1 ? "waiting_claude" : "waiting_andres", messages } };
      }
    };
    const r = await mesa(["ticket", "ask", "--title", "x", "--wait"]);
    expect(r.code).toBe(0);
    expect(r.json()).toEqual({ ticket: { id: "tk_1", ref: "t1", status: "waiting_claude" }, answer: { body: "Opción A", chosen: "A", at: "2026-11-03T10:01:00.000Z" } });
    const waits = requests.filter((q) => q.path === "/api/wait");
    expect(waits.length).toBe(1);
    expect(waits[0].query).toMatchObject({ session: "lead", peek: "1" });
    expect(requests.some((q) => q.path === "/api/wait/ack")).toBe(false);
  });

  it("ticket ask --wait --timeout exits 3 without an answer", async () => {
    handler = (q) => {
      if (q.path === "/api/tickets") return { body: { id: "tk_1", ref: "t1", messages: [] } };
      if (q.path === "/api/wait") return { body: { events: [], cursor: 0 } };
      return { body: { id: "tk_1", ref: "t1", status: "waiting_andres", messages: [] } };
    };
    const r = await mesa(["ticket", "ask", "--title", "x", "--wait", "--timeout", "1"]);
    expect(r.code).toBe(3);
    expect(r.json()).toMatchObject({ answer: null, timedOut: true });
  });

  it("salida propose --wait-release returns on release and exits 3 on deny", async () => {
    let status = "pending";
    handler = (q) => {
      if (q.method === "POST" && q.path === "/api/salidas") return { status: 201, body: { id: "sa_1", status: "pending" } };
      if (q.path === "/api/wait") {
        status = "sending";
        return { body: { events: [{ id: 3, kind: "salida.released" }], cursor: 3 } };
      }
      if (q.path === "/api/salidas/sa_1") return { body: { id: "sa_1", status, releasedAt: status === "sending" ? "2026-11-03T10:00:20Z" : null, approvedVersion: 1 } };
    };
    const args = ["salida", "propose", "--source", "slack", "--dest", '{"kind":"slack_thread","workspace":"w","channel":"c","postAs":"Andrés"}', "--body", "hola", "--wait-release"];
    const ok = await mesa(args);
    expect(ok.code).toBe(0);
    expect(ok.json()).toMatchObject({ released: true, salida: { id: "sa_1", status: "sending" } });
    expect(requests[0].body).toMatchObject({ source: "slack", destination: { kind: "slack_thread" }, body: "hola", ownerSession: "lead" });

    handler = (q) => {
      if (q.method === "POST") return { status: 201, body: { id: "sa_2", status: "pending" } };
      if (q.path === "/api/salidas/sa_2") return { body: { id: "sa_2", status: "denied" } };
      return { body: { events: [], cursor: 0 } };
    };
    const denied = await mesa(args);
    expect(denied.code).toBe(3);
    expect(denied.stderr).toMatch(/denied: do not send it/);
  });

  it("wait prints one JSON line per event and acks the cursor; --manual-ack does not", async () => {
    handler = (q) => (q.path === "/api/wait" ? { body: { events: [{ id: 4, kind: "ticket.answered" }, { id: 5, kind: "salida.released" }], cursor: 5 } } : { body: {} });
    const r = await mesa(["wait", "--timeout", "1"]);
    expect(r.stdout.trim().split("\n").map((l) => JSON.parse(l).id)).toEqual([4, 5]);
    expect(requests.find((q) => q.path === "/api/wait/ack").body).toEqual({ session: "lead", cursor: 5 });

    requests = [];
    await mesa(["wait", "--timeout", "1", "--manual-ack"]);
    expect(requests.some((q) => q.path === "/api/wait/ack")).toBe(false);
    await mesa(["ack", "5"]);
    expect(requests.at(-1)).toMatchObject({ path: "/api/wait/ack", body: { session: "lead", cursor: 5 } });
  });

  it("wait requires a session", async () => {
    const r = await mesa(["wait"], { env: { MESA_SESSION: "" } });
    expect(r.code).toBe(2);
  });

  it("source set maps flags to the sweeper fields", async () => {
    await mesa(["source", "set", "slack", "--health", "down", "--note", "sin conexión", "--watermark", "1730650000.0001", "--checked", "now", "--backoff-until", "none", "--cadence", "120", "--error-count", "2", "--last-error", "none"]);
    const b = requests[0].body;
    expect(requests[0]).toMatchObject({ method: "PATCH", path: "/api/sources/slack" });
    expect(b).toMatchObject({ health: "down", note: "sin conexión", watermark: "1730650000.0001", backoffUntil: null, cadenceS: 120, errorCount: 2, lastError: null });
    expect(Date.parse(b.lastChecked)).toBeGreaterThan(0);
  });

  it("item upsert sends the JSON from stdin", async () => {
    handler = () => ({ body: { item: { id: "it_1" }, created: true } });
    const item = { source: "slack", externalId: "slack:C1:1.2", kind: "message", title: "Ana · ¿revisas?" };
    const r = await mesa(["item", "upsert", "--json", "-"], { stdin: JSON.stringify(item) });
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/items/upsert", body: item });
  });

  it("ignore list --json prints the rows as JSON for the sweeper", async () => {
    const rows = [{ id: "ig_1", source: "slack", project: "C0DEPLOY", label: "#deploys", hidden: { items: 2, tasks: 0 } }];
    handler = () => ({ body: rows });
    const r = await mesa(["ignore", "list", "--json"], { env: { MESA_SESSION: "sweeper" } });
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "GET", path: "/api/ignored-projects" });
    expect(r.json()).toEqual(rows);
  });

  it("ignore add / remove by id or by source + project key", async () => {
    handler = (q) =>
      q.method === "GET" ? { body: [{ id: "ig_9", source: "github", project: "designli/scout", label: "scout" }] } : { body: { ignored: { id: "ig_9" }, created: true } };
    expect((await mesa(["ignore", "add", "github", "designli/scout", "--label", "scout"])).code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/ignored-projects", body: { source: "github", project: "designli/scout", label: "scout" } });
    expect((await mesa(["ignore", "add", "*", "freightmate"])).code).toBe(0);
    expect(requests[1]).toMatchObject({ body: { source: "*", project: "freightmate" } });

    expect((await mesa(["ignore", "remove", "ig_9"])).code).toBe(0);
    expect(requests[2]).toMatchObject({ method: "DELETE", path: "/api/ignored-projects/ig_9" });
    requests = [];
    expect((await mesa(["ignore", "remove", "github", "designli/scout"])).code).toBe(0);
    expect(requests.map((q) => `${q.method} ${q.path}`)).toEqual(["GET /api/ignored-projects", "DELETE /api/ignored-projects/ig_9"]);
    const miss = await mesa(["ignore", "remove", "slack", "C404"]);
    expect(miss.code).toBe(1);
    expect(miss.stderr).toContain("is not ignored");
    expect((await mesa(["ignore", "add", "github"])).code).toBe(2);
  });

  it("github sync / status / import-reviews hit the server-side endpoints", async () => {
    await mesa(["github", "sync"]);
    await mesa(["github", "status"]);
    await mesa(["github", "import-reviews"]);
    expect(requests.map((q) => `${q.method} ${q.path}`)).toEqual(["POST /api/github/sync", "GET /api/github/status", "POST /api/github/import-reviews"]);
  });

  it("team retire passes the reason; handoff collects artifacts", async () => {
    await mesa(["team", "retire", "dev-t1", "--reason", "done"]);
    expect(requests[0]).toMatchObject({ path: "/api/team/dev-t1/retire", body: { reason: "done" } });
    await mesa(["ticket", "handoff", "t1", "--agent", "dev-t1", "--status", "paused", "--body", "-", "--branch", "feat/x", "--pr", "12", "--file", "a.ts", "--file", "b.ts"], {
      stdin: "estado",
    });
    expect(requests[1]).toMatchObject({
      path: "/api/tickets/t1/handoffs",
      body: { agent: "dev-t1", status: "paused", body: "estado", artifacts: { branch: "feat/x", pr: "12", files: ["a.ts", "b.ts"] } },
    });
  });

  it("prints a human summary with --human and JSON for sessions", async () => {
    handler = () => ({ body: [{ ref: "t1", status: "waiting_andres", title: "¿Bucket nuevo?" }] });
    const h = await mesa(["ticket", "list", "--human"]);
    expect(h.stdout.trim()).toBe("t1  [waiting_andres]  ¿Bucket nuevo?");
    const j = await mesa(["ticket", "list"]);
    expect(j.json()).toEqual([{ ref: "t1", status: "waiting_andres", title: "¿Bucket nuevo?" }]);
  });

  it("reports API errors on stderr with exit 1", async () => {
    handler = () => ({ status: 409, body: { error: { code: "invalid_transition", message: "cannot send before release" } } });
    const r = await mesa(["salida", "sent", "sa_1"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("409 cannot send before release");
  });
});
