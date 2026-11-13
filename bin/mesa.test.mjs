// CLI tests: run bin/mesa as a child process against a fake Mesa API and check the
// requests it makes (method, path, body), its output and its exit codes.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
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
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);
    const url = new URL(req.url, "http://x");
    // A multipart upload (ticket attach) is parsed into `form`: { fields, file: { name, type, size, text } }.
    let form;
    if (String(req.headers["content-type"] ?? "").startsWith("multipart/form-data")) {
      const fd = await new Request("http://x", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body: buf }).formData();
      const file = fd.get("file");
      form = { fields: Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")), file: file && { name: file.name, type: file.type, size: file.size, text: await file.text() } };
    }
    const raw = form ? "" : buf.toString("utf8");
    const r = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: raw ? JSON.parse(raw) : undefined, form, headers: req.headers };
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
      "mesa ticket fold",
      "mesa ticket unfold",
      "mesa salida propose",
      "--wait-release",
      "mesa salida sent",
      "mesa salida drafted",
      "mesa salida hold",
      "mesa salida bounce",
      "mesa handoff",
      "mesa team add",
      "mesa finding upsert",
      "mesa review open",
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
      "mesa task create",
      "--note-only",
      "mesa task dispatch",
      "mesa task move",
      "mesa lead focus",
      "mesa ticket questions",
      "mesa ticket question withdraw",
      "mesa ticket checklist",
      "mesa ticket check",
      "ticket.checklist",
      "mesa ticket attach",
      "mesa ticket annotations",
      "mesa ticket annotation-reply",
    ]) {
      expect(r.stdout).toContain(c);
    }
  });

  it("help names the owner by MESA_OWNER_NAME, and Andrés when it is not set", async () => {
    const canonical = (await mesa(["help"], { env: { MESA_OWNER_NAME: "" } })).stdout;
    expect(canonical).toContain("Andrés");
    const ana = (await mesa(["help"], { env: { MESA_OWNER_NAME: "Ana" } })).stdout;
    expect(ana).not.toMatch(/Andr[eé]s/);
    expect(ana).toContain("nothing is sent without Ana's approval");
  });

  it("a calendar salida is posted as MESA_OWNER_FULL_NAME, else MESA_OWNER_NAME, else the canonical full name", async () => {
    const postAs = async (env) => {
      requests = [];
      handler = () => ({ status: 200, body: { id: "s1" } });
      const r = await mesa(["calendar", "propose", "--title", "Sync", "--start", "2026-11-16T10:00:00-05:00", "--end", "2026-11-16T10:30:00-05:00"], { env });
      expect(r.code, r.stderr).toBe(0);
      return requests.find((q) => q.path === "/api/salidas")?.body.destination.postAs;
    };
    expect(await postAs({ MESA_OWNER_NAME: "", MESA_OWNER_FULL_NAME: "" })).toBe("Andrés Correa");
    expect(await postAs({ MESA_OWNER_NAME: "Ana", MESA_OWNER_FULL_NAME: "" })).toBe("Ana");
    expect(await postAs({ MESA_OWNER_NAME: "Ana", MESA_OWNER_FULL_NAME: "Ana Dev Lopez" })).toBe("Ana Dev Lopez");
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

  it("ticket action reports a step, skipped included, and documents it in help", async () => {
    for (const state of ["running", "done", "failed", "skipped"]) {
      requests = [];
      const r = await mesa(["ticket", "action", "pa_1", "--state", state]);
      expect(r.code).toBe(0);
      expect(requests).toMatchObject([{ method: "PATCH", path: "/api/actions/pa_1", body: { state } }]);
    }
    expect((await mesa(["ticket", "action", "pa_1"])).code).toBe(2);
    expect((await mesa(["help"])).stdout).toMatch(/ticket action <actionId> --state running|done|failed|skipped/);
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
        if (polls > 1) messages.push({ id: "m2", author: "andres", body: "Opción A", chosen: "A", createdAt: "2026-11-03T10:01:00.000Z" });
        const questions = [{ id: "tq_1", n: 1, chosen: polls > 1 ? "A" : null, answerText: null, answerMessageId: polls > 1 ? "m2" : null }];
        return { body: { id: "tk_1", ref: "t1", status: polls > 1 ? "waiting_claude" : "waiting_andres", messages, questions } };
      }
    };
    const r = await mesa(["ticket", "ask", "--title", "x", "--wait"]);
    expect(r.code).toBe(0);
    expect(r.json()).toEqual({ ticket: { id: "tk_1", ref: "t1", status: "waiting_claude" }, answer: {
        body: "Opción A",
        chosen: "A",
        answers: [{ questionId: "tq_1", n: 1, chosen: "A", text: null }],
        at: "2026-11-03T10:01:00.000Z",
      },
    });
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

  it("every request carries x-mesa-client: cli, so the server does not count it as Andrés's interaction", async () => {
    handler = (q) => (q.path === "/api/wait" ? { body: { events: [{ id: 4, kind: "ticket.answered" }], cursor: 4 } } : { body: { id: "tk_1", ref: "t1", tickets: [], questions: [] } });
    await mesa(["wait", "--timeout", "1"]); // GET /api/wait, POST /api/wait/ack
    await mesa(["source", "set", "slack", "--health", "ok"]); // PATCH
    await mesa(["ticket", "context", "t1"]); // GET
    expect(requests.length).toBeGreaterThanOrEqual(4);
    expect(new Set(requests.map((q) => q.method)).size).toBeGreaterThanOrEqual(3);
    for (const q of requests) expect(q.headers["x-mesa-client"], `${q.method} ${q.path}`).toBe("cli");
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

  it("ticket questions posts one card from stdin, mapping recommend/why to the API fields", async () => {
    handler = () => ({ body: { id: "tk_1", ref: "t1", questions: [] } });
    const card = {
      body: "Tres decisiones",
      questions: [
        { text: "¿Cuándo?", options: [{ key: "A", label: "Hoy" }, { key: "B", label: "Mañana", detail: "con el fix" }], recommend: "B", why: "entra el fix" },
        { text: "¿Quién?", options: [{ key: "A", label: "Yo" }, { key: "B", label: "Tú" }] },
      ],
      refs: ["t3"],
    };
    const r = await mesa(["ticket", "questions", "t1", "--json", "-"], { stdin: JSON.stringify(card) });
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/api/tickets/t1/messages",
      body: {
        author: "claude",
        body: "Tres decisiones",
        questions: [
          { text: "¿Cuándo?", options: card.questions[0].options, recommended: "B", recommendation: "entra el fix" },
          { text: "¿Quién?", options: card.questions[1].options },
        ],
        refs: [{ refType: "ticket", target: "t3" }],
        session: "lead",
      },
    });
    const bad = await mesa(["ticket", "questions", "t1", "--json", "-"], { stdin: JSON.stringify({ body: "x" }) });
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/--json wants/);
    expect(requests).toHaveLength(1);
  });

  it("ticket checklist posts one message of steps from stdin; strings are steps, the body and refs ride along", async () => {
    handler = () => ({ body: { id: "tk_1", ref: "t1", checklists: [] } });
    const list = { body: "Dos pasos tuyos", steps: [{ text: "Pega la URL", detail: "en `.env.local`" }, "Reinicia Mesa"], refs: ["t112"] };
    const r = await mesa(["ticket", "checklist", "t1", "--json", "-"], { stdin: JSON.stringify(list) });
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/api/tickets/t1/checklist",
      body: { body: "Dos pasos tuyos", steps: [{ text: "Pega la URL", detail: "en `.env.local`" }, { text: "Reinicia Mesa" }], refs: [{ refType: "ticket", target: "t112" }], session: "lead" },
    });
    expect(requests[0].headers["x-mesa-client"]).toBe("cli");
    const bad = await mesa(["ticket", "checklist", "t1", "--json", "-"], { stdin: JSON.stringify({ body: "x" }) });
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/--json wants/);
    expect((await mesa(["ticket", "checklist", "--json", "-"], { stdin: JSON.stringify(list) })).code).toBe(2);
    expect(requests).toHaveLength(1);
  });

  it("ticket check marks a step done with its note, --undo reopens it, <message>/<n> goes as <message>.<n>", async () => {
    handler = () => ({ body: { id: "tk_1", ref: "t1", checklists: [] } });
    expect((await mesa(["ticket", "check", "t1", "2", "--note", "Mesa dice configured:true"])).code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "PUT", path: "/api/tickets/t1/steps/2", body: { done: true, note: "Mesa dice configured:true", session: "lead" } });
    expect(requests[0].headers["x-mesa-client"]).toBe("cli");
    expect((await mesa(["ticket", "check", "t1", "ck_9"])).code).toBe(0);
    expect(requests[1]).toMatchObject({ method: "PUT", path: "/api/tickets/t1/steps/ck_9", body: { done: true } });
    expect(requests[1].body.note).toBeUndefined();
    expect((await mesa(["ticket", "check", "t1", "tm_5/3", "--undo"])).code).toBe(0);
    expect(requests[2]).toMatchObject({ method: "PUT", path: "/api/tickets/t1/steps/tm_5.3", body: { done: false } });
    expect((await mesa(["ticket", "check", "t1", "--undo", "2"])).code).toBe(0);
    expect(requests[3]).toMatchObject({ path: "/api/tickets/t1/steps/2", body: { done: false } });
  });

  it("ticket check needs the ref and the step, and a note does not go with --undo", async () => {
    handler = () => ({ body: {} });
    expect((await mesa(["ticket", "check", "t1"])).code).toBe(2);
    expect((await mesa(["ticket", "check"])).code).toBe(2);
    expect((await mesa(["ticket", "check", "t1", "2", "--undo", "--note", "x"])).code).toBe(2);
    expect(requests).toHaveLength(0);
  });

  it("ticket question withdraw posts the reason; it needs the id and --why", async () => {
    handler = () => ({ body: { id: "tq_1", state: "withdrawn" } });
    const r = await mesa(["ticket", "question", "withdraw", "tq_1", "--why", "ya lo respondió en el hilo"]);
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/questions/tq_1/withdraw", body: { reason: "ya lo respondió en el hilo", session: "lead" } });
    expect((await mesa(["ticket", "question", "withdraw", "tq_1"])).code).toBe(2);
    expect((await mesa(["ticket", "question", "withdraw", "--why", "x"])).code).toBe(2);
    expect((await mesa(["ticket", "question", "close", "tq_1", "--why", "x"])).code).toBe(2);
    expect(requests).toHaveLength(1);
  });

  it("item upsert sends the JSON from stdin", async () => {
    handler = () => ({ body: { item: { id: "it_1" }, created: true } });
    const item = { source: "slack", externalId: "slack:C1:1.2", kind: "message", title: "Ana · ¿revisas?" };
    const r = await mesa(["item", "upsert", "--json", "-"], { stdin: JSON.stringify(item) });
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/items/upsert", body: item });
  });

  it("finding upsert stores JSON-escaped backslashes and quotes verbatim", async () => {
    handler = () => ({ body: { finding: { n: 1 } } });
    const f = { repo: "acme/api", pr: 5, label: "nit", summary: 'a\\b \\d+ "x" C:\\dir\\new', ghCommentId: 3254 };
    const r = await mesa(["finding", "upsert", "t22", "--json", "-"], { stdin: `${JSON.stringify(f)}\n` });
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/tickets/t22/findings", body: f });
  });

  it("finding upsert repairs lone backslashes a shell left behind (\\d from \\\\d)", async () => {
    handler = () => ({ body: { finding: { n: 1 } } });
    const r = await mesa(["finding", "upsert", "t22", "--json", "-"], { stdin: '{"repo":"acme/api","pr":5,"label":"nit","summary":"a \\d+ \\"x\\" \\\\ok"}' });
    expect(r.code).toBe(0);
    expect(requests[0].body.summary).toBe('a \\d+ "x" \\ok');
  });

  it("invalid --json prints JSON.parse's own message, for finding, item and --dest", async () => {
    const bad = '{"repo": "a/b", "pr": }';
    for (const args of [
      ["finding", "upsert", "t22", "--json", "-"],
      ["item", "upsert", "--json", "-"],
    ]) {
      const r = await mesa(args, { stdin: bad });
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/--json must be JSON: Unexpected token '\}'/); // the engine's own message (position or context)
    }
    const d = await mesa(["salida", "propose", "--source", "slack", "--dest", '{"kind": ', "--body", "x"]);
    expect(d.code).toBe(2);
    expect(d.stderr).toMatch(/--dest must be JSON: /);
    expect(requests).toHaveLength(0);
  });

  it("salida propose passes --ticket through as given (the server resolves a ref or an id)", async () => {
    handler = () => ({ status: 201, body: { id: "sa_1", status: "pending" } });
    const r = await mesa(["salida", "propose", "--source", "slack", "--dest", '{"kind":"slack_channel","workspace":"w","channel":"c","postAs":"Andrés"}', "--body", "hola", "--ticket", "t22"]);
    expect(r.code).toBe(0);
    expect(requests[0].body.ticketId).toBe("t22");
  });

  it("calendar propose --repeat writes the Repetir line after Meet and before Descripción, and lists in help", async () => {
    expect((await mesa(["help"])).stdout).toMatch(/mesa calendar propose[\s\S]*--repeat "RRULE:FREQ=WEEKLY;BYDAY=WE"/);
    handler = () => ({ status: 201, body: { id: "sa_1", status: "pending" } });
    const rule = "RRULE:FREQ=WEEKLY;BYDAY=WE";
    const r = await mesa([
      "calendar", "propose", "--title", "DRE Weekly", "--start", "2026-11-18T16:00:00-05:00", "--end", "2026-11-18T16:30:00-05:00",
      "--invitee", "matt.r@scoutapp.example", "--repeat", rule, "--description", "Weekly.",
    ]);
    expect(r.code).toBe(0);
    expect(requests[0].body.body).toBe(
      "Título: DRE Weekly\nInicio: 2026-11-18T16:00:00-05:00\nFin: 2026-11-18T16:30:00-05:00\nZona: America/Bogota\nInvitados: matt.r@scoutapp.example\nMeet: sí\nRepetir: RRULE:FREQ=WEEKLY;BYDAY=WE\nDescripción: Weekly.",
    );
    expect(requests[0].body.destination).toMatchObject({ kind: "calendar_event", recurrence: rule });
  });

  it("calendar propose without --repeat writes no Repetir line", async () => {
    handler = () => ({ status: 201, body: { id: "sa_1", status: "pending" } });
    const r = await mesa(["calendar", "propose", "--title", "T", "--start", "2026-11-18T16:00:00-05:00", "--end", "2026-11-18T16:30:00-05:00"]);
    expect(r.code).toBe(0);
    expect(requests[0].body.body).not.toContain("Repetir");
    expect(requests[0].body.destination).not.toHaveProperty("recurrence");
  });

  it("calendar propose --repeat with an invalid rule comes back as the server's 400 and its Spanish problem", async () => {
    handler = () => ({ status: 400, body: { error: { message: "calendar salida body: Repetir debe empezar por RRULE:, p. ej. RRULE:FREQ=WEEKLY;BYDAY=WE" } } });
    const r = await mesa(["calendar", "propose", "--title", "T", "--start", "2026-11-18T16:00:00-05:00", "--end", "2026-11-18T16:30:00-05:00", "--repeat", "FREQ=WEEKLY"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/mesa: 400 calendar salida body: Repetir debe empezar por RRULE:/);
    expect(requests[0].body.body).toContain("Repetir: FREQ=WEEKLY");
  });

  it("help says a state-only finding upsert needs only {repo, pr, n, state}", async () => {
    expect((await mesa(["help"])).stdout).toMatch(/state-only upsert needs only \{repo, pr, n, state\}/);
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

  it("review open posts repo, pr and sha to the ticket's reviews endpoint, and rejects missing or bad arguments", async () => {
    handler = () => ({ body: { review: { id: "rv_1", state: "open", findings: [] } } });
    const r = await mesa(["review", "open", "t4", "--repo", "acme/scout", "--pr", "59", "--sha", "abc1234"]);
    expect(r.code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/tickets/t4/reviews", body: { repo: "acme/scout", pr: 59, sha: "abc1234" } });
    expect(r.json().review.state).toBe("open");

    requests = [];
    for (const args of [
      ["review", "open", "t4", "--repo", "acme/scout", "--pr", "59"],
      ["review", "open", "t4", "--repo", "acme/scout", "--sha", "abc"],
      ["review", "open", "t4", "--pr", "59", "--sha", "abc"],
      ["review", "open", "--repo", "acme/scout", "--pr", "59", "--sha", "abc"],
      ["review", "open", "t4", "--repo", "acme/scout", "--pr", "x", "--sha", "abc"],
    ]) {
      expect((await mesa(args)).code).toBe(2);
    }
    expect(requests).toEqual([]);
  });

  it("lead focus sets, reads and clears the ticket the lead acts on, and refuses unknown subcommands", async () => {
    handler = () => ({ body: { ticketRef: "t10" } });
    expect((await mesa(["lead", "focus", "t10"])).json()).toEqual({ ticketRef: "t10" });
    await mesa(["lead", "focus"]);
    await mesa(["lead", "focus", "--clear"]);
    expect(requests.map((q) => `${q.method} ${q.path}`)).toEqual(["PUT /api/lead/focus", "GET /api/lead/focus", "DELETE /api/lead/focus"]);
    expect(requests[0].body).toEqual({ ticket: "t10" });
    requests = [];
    expect((await mesa(["lead", "nope"])).code).toBe(2);
    expect(requests).toEqual([]);
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

  it("task create hands the card to Claude unless --note-only; dispatch and move hit their routes", async () => {
    handler = () => ({ status: 201, body: { id: "ta_1", title: "x", ticket: { id: "tk_1", ref: "t9" } } });
    await mesa(["task", "create", "--title", "Revisar backups", "--project", "freightmate"]);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/tasks", body: { title: "Revisar backups", source: "claude", project: "freightmate", noteOnly: false } });
    await mesa(["task", "create", "--title", "Solo nota", "--note-only"]);
    expect(requests[1].body).toMatchObject({ title: "Solo nota", noteOnly: true });
    await mesa(["task", "dispatch", "ta_1", "--kind", "review"]);
    expect(requests[2]).toMatchObject({ method: "POST", path: "/api/tasks/ta_1/dispatch", body: { kind: "review" } });
    await mesa(["task", "move", "ta_1", "doing"]);
    expect(requests[3]).toMatchObject({ method: "POST", path: "/api/tasks/ta_1/move", body: { station: "doing" } });
    await mesa(["task", "list", "--station", "todo"]);
    expect(requests[4]).toMatchObject({ method: "GET", path: "/api/tasks", query: { station: "todo" } });
    expect((await mesa(["task", "explode"])).code).toBe(2);
  });

  it("sends --simulated as simulated:true without a permalink, in either argument order", async () => {
    for (const args of [["salida", "sent", "sa_1", "--simulated"], ["salida", "sent", "--simulated", "sa_1"]]) {
      requests = [];
      const r = await mesa(args);
      expect(r.code).toBe(0);
      expect(requests[0]).toMatchObject({ method: "POST", path: "/api/salidas/sa_1/transition", body: { type: "sent", simulated: true } });
      expect(requests[0].body.permalink).toBeUndefined();
    }
    const both = await mesa(["salida", "sent", "sa_1", "--simulated", "--permalink", "https://x"]);
    expect(both.code).toBe(2);
    const real = await mesa(["salida", "sent", "sa_1", "--permalink", "https://x"]);
    expect(real.code).toBe(0);
    expect(requests.at(-1).body).toEqual({ type: "sent", permalink: "https://x" });
  });

  it("salida drafted posts the drafted event, simulated only with --simulated, in either argument order", async () => {
    const real = await mesa(["salida", "drafted", "sa_1"]);
    expect(real.code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/salidas/sa_1/transition", body: { type: "drafted" } });
    expect(requests[0].body.simulated).toBeUndefined();
    for (const args of [["salida", "drafted", "sa_1", "--simulated"], ["salida", "drafted", "--simulated", "sa_1"]]) {
      requests = [];
      expect((await mesa(args)).code).toBe(0);
      expect(requests[0]).toMatchObject({ method: "POST", path: "/api/salidas/sa_1/transition", body: { type: "drafted", simulated: true } });
    }
    expect((await mesa(["salida", "drafted"])).code).toBe(2);
  });

  it("has no verb for \"Ya lo envié\" or the Slack mode: those are Andrés's clicks", async () => {
    for (const args of [["salida", "confirm_sent", "sa_1"], ["salida", "approve", "sa_1", "--mode", "send"], ["salida", "mode", "sa_1", "send"]]) {
      requests = [];
      expect((await mesa(args)).code).toBe(2);
      expect(requests).toEqual([]);
    }
  });

  it("propose --wait-release also returns for a salida that is already draft_created", async () => {
    handler = (q) => {
      if (q.method === "POST") return { status: 201, body: { id: "sa_1", status: "pending" } };
      if (q.path === "/api/salidas/sa_1") return { body: { id: "sa_1", status: "draft_created", releasedAt: "2026-11-03T10:00:20Z", sendMode: "draft" } };
      return { body: { events: [], cursor: 0 } };
    };
    const args = ["salida", "propose", "--source", "slack", "--dest", '{"kind":"slack_thread","workspace":"w","channel":"c","postAs":"Andrés"}', "--body", "hola", "--wait-release", "--timeout", "2"];
    const r = await mesa(args);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ released: true, salida: { id: "sa_1", status: "draft_created" } });
  });

  it("ticket pause, ongoing and resume post their transition events as Claude; the reason is required (t126)", async () => {
    const h = await mesa(["help"]);
    for (const c of ["mesa ticket pause", "--until-ticket", "mesa ticket ongoing", "mesa ticket resume"]) expect(h.stdout).toContain(c);

    expect((await mesa(["ticket", "pause", "t87", "--reason", "Espera la vista de PDF", "--until-ticket", "t125"])).code).toBe(0);
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/api/tickets/t87/transition",
      body: { event: "pause", by: "claude", reason: "Espera la vista de PDF", untilTicket: "t125" },
    });
    requests = [];
    await mesa(["ticket", "pause", "t87", "--reason", "esperando al cliente hasta el viernes"]);
    expect(requests[0].body).toMatchObject({ event: "pause", by: "claude", reason: "esperando al cliente hasta el viernes" });
    expect(requests[0].body.untilTicket).toBeUndefined();
    requests = [];
    await mesa(["ticket", "ongoing", "t90", "--reason", "CI corriendo"]);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/tickets/t90/transition", body: { event: "ongoing", by: "claude", reason: "CI corriendo" } });
    requests = [];
    await mesa(["ticket", "resume", "t87"]);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/tickets/t87/transition", body: { event: "resume", by: "claude" } });
    requests = [];
    // usage errors never reach the server
    expect((await mesa(["ticket", "pause", "t87"])).code).toBe(2);
    expect((await mesa(["ticket", "pause", "t87", "--reason", ""])).code).toBe(2);
    expect((await mesa(["ticket", "pause", "--reason", "x"])).code).toBe(2);
    expect((await mesa(["ticket", "ongoing", "t90"])).code).toBe(2);
    expect((await mesa(["ticket", "ongoing", "t90", "--reason", "x", "--until-ticket", "t1"])).code).toBe(2);
    expect((await mesa(["ticket", "pause", "t87", "--reason", "x", "--until-ticket", "t1", "--until-ticket", "t2"])).code).toBe(2);
    expect((await mesa(["ticket", "resume"])).code).toBe(2);
    expect(requests).toEqual([]);
  });

  it("salida withdraw posts the withdraw event with its reason; the reason is required", async () => {
    const r = await mesa(["salida", "withdraw", "sa_1", "--reason", "stale leftover of mesa#36"]);
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/salidas/sa_1/transition", body: { type: "withdraw", reason: "stale leftover of mesa#36" } });
    requests = [];
    expect((await mesa(["salida", "withdraw", "sa_1"])).code).toBe(2);
    expect((await mesa(["salida", "withdraw", "sa_1", "--reason", ""])).code).toBe(2);
    expect((await mesa(["salida", "withdraw", "--reason", "x"])).code).toBe(2);
    expect(requests).toEqual([]);
  });

  it("review close posts the reason to the review's own close endpoint, not /actions", async () => {
    const r = await mesa(["review", "close", "rv_1", "--reason", "stale card"]);
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/reviews/rv_1/close", body: { reason: "stale card" } });
    requests = [];
    expect((await mesa(["review", "close", "rv_1"])).code).toBe(2);
    expect((await mesa(["review", "close", "--reason", "x"])).code).toBe(2);
    expect(requests).toEqual([]);
  });

  it("help lists salida withdraw and review close, and propose --wait-release exits 3 on a withdrawn salida", async () => {
    const h = await mesa(["help"]);
    expect(h.stdout).toContain("mesa salida withdraw");
    expect(h.stdout).toContain("mesa review close");
    handler = (q) => {
      if (q.method === "POST") return { status: 201, body: { id: "sa_3", status: "pending" } };
      if (q.path === "/api/salidas/sa_3") return { body: { id: "sa_3", status: "withdrawn", withdrawReason: "stale" } };
      return { body: { events: [], cursor: 0 } };
    };
    const w = await mesa(["salida", "propose", "--source", "slack", "--dest", '{"kind":"slack_thread","workspace":"w","channel":"c","postAs":"Andrés"}', "--body", "hola", "--wait-release"]);
    expect(w.code).toBe(3);
    expect(w.stderr).toMatch(/withdrawn: do not send it/);
  });
});

describe("PDF review (t125)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "mesa-attach-"));
  const pdf = join(scratch, "informe costos.pdf");
  writeFileSync(pdf, "%PDF-1.4 fake");

  it("ticket attach uploads the file as multipart to the existing route and prints the attachment", async () => {
    handler = () => ({ status: 201, body: { id: "at_1", ticketId: "tk_1", filename: "informe_costos.pdf", mime: "application/pdf", size: 13 } });
    const r = await mesa(["ticket", "attach", "t87", pdf, "--message", "tm_9"]);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ id: "at_1", mime: "application/pdf" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/tickets/t87/attachments" });
    expect(requests[0].form).toEqual({ fields: { messageId: "tm_9" }, file: { name: "informe costos.pdf", type: "application/pdf", size: 13, text: "%PDF-1.4 fake" } });
    expect(requests[0].headers["x-mesa-client"]).toBe("cli");
  });

  it("ticket attach without --message sends no messageId, and fails clearly on a missing file or arguments", async () => {
    handler = () => ({ status: 201, body: { id: "at_2" } });
    await mesa(["ticket", "attach", "t87", pdf]);
    expect(requests[0].form.fields).toEqual({});
    requests = [];
    const gone = await mesa(["ticket", "attach", "t87", join(scratch, "nope.pdf")]);
    expect(gone.code).toBe(1);
    expect(gone.stderr).toMatch(/cannot read .*nope\.pdf/);
    expect((await mesa(["ticket", "attach", "t87"])).code).toBe(2);
    expect((await mesa(["ticket", "attach"])).code).toBe(2);
    expect(requests).toEqual([]);
  });

  it("ticket attach shows the server's refusal (25 MB) and exits 1", async () => {
    handler = () => ({ status: 413, body: { error: { code: "too_large", message: "attachments are limited to 25 MB" } } });
    const r = await mesa(["ticket", "attach", "t87", pdf]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/413 attachments are limited to 25 MB/);
  });

  it("ticket annotations reads the ticket's marks, with --att and --open as filters", async () => {
    handler = () => ({ body: [{ id: "an_1", page: 2, kind: "highlight", rect: { x: 1, y: 2, w: 3, h: 4 }, quote: "Costo", body: "¿IVA?", state: "open", replies: [] }] });
    const r = await mesa(["ticket", "annotations", "t87"]);
    expect(r.code).toBe(0);
    expect(r.json()[0]).toMatchObject({ id: "an_1", page: 2, kind: "highlight", quote: "Costo" });
    expect(requests[0]).toMatchObject({ method: "GET", path: "/api/tickets/t87/annotations", query: {} });
    await mesa(["ticket", "annotations", "t87", "--att", "at_1", "--open"]);
    expect(requests[1]).toMatchObject({ method: "GET", path: "/api/tickets/t87/annotations", query: { att: "at_1", open: "1" } });
    expect((await mesa(["ticket", "annotations"])).code).toBe(2);
  });

  it("ticket annotations prints general comments untouched (kind comment, page 0 = the whole document), and the help says so", async () => {
    const marks = [
      { id: "an_1", page: 0, kind: "comment", geometry: {}, rect: { x: 0, y: 0, w: 0, h: 0 }, quote: "", body: "todo el informe", state: "open", replies: [] },
      { id: "an_2", page: 2, kind: "comment", geometry: {}, rect: { x: 0, y: 0, w: 0, h: 0 }, quote: "", body: "esta página", state: "open", replies: [] },
      { id: "an_3", page: 2, kind: "note", geometry: { x: 1, y: 1 }, rect: { x: 1, y: 1, w: 0, h: 0 }, quote: "", body: "pin", state: "open", replies: [] },
    ];
    handler = () => ({ body: marks });
    const r = await mesa(["ticket", "annotations", "t87", "--att", "at_1", "--open"]);
    expect(r.code).toBe(0);
    expect(r.json()).toEqual(marks);
    const help = await mesa(["help"]);
    expect(help.stdout).toMatch(/kind highlight\|note\|rect\|ellipse\|arrow\|comment/);
    expect(help.stdout).toMatch(/general comment: no geometry, page 0 = the whole document/);
  });

  it("ticket annotation-reply posts Claude's body (stdin works) to the mark's replies", async () => {
    handler = () => ({ status: 201, body: { id: "an_1", replies: [{ author: "claude", body: "Es sin IVA" }] } });
    const r = await mesa(["ticket", "annotation-reply", "t87", "an_1", "--body", "-"], { stdin: "Es sin IVA\n" });
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/tickets/t87/annotations/an_1/replies", body: { body: "Es sin IVA" } });
    expect(requests[0].headers["x-mesa-client"]).toBe("cli");
    requests = [];
    expect((await mesa(["ticket", "annotation-reply", "t87", "an_1"])).code).toBe(2);
    expect((await mesa(["ticket", "annotation-reply", "t87", "--body", "x"])).code).toBe(2);
    expect(requests).toEqual([]);
  });

  it("ticket annotation-reply works unchanged on a general comment", async () => {
    handler = () => ({ status: 201, body: { id: "an_9", kind: "comment", page: 0, replies: [{ author: "claude", body: "Listo" }] } });
    const r = await mesa(["ticket", "annotation-reply", "t87", "an_9", "--body", "-"], { stdin: "Listo\n" });
    expect(r.code).toBe(0);
    expect(requests[0]).toMatchObject({ method: "POST", path: "/api/tickets/t87/annotations/an_9/replies", body: { body: "Listo" } });
    expect(r.json()).toMatchObject({ kind: "comment", page: 0 });
  });
});
