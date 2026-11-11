// The CLI is a thin wrapper: check the REST call each ticket / sandbox command makes, against a stub server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const MESA = fileURLToPath(new URL("../../bin/mesa", import.meta.url));

async function run(args) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : undefined });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const env = { ...process.env, MESA_URL: `http://127.0.0.1:${port}`, MESA_SESSION: "dev-test" };
  delete env.MESA_ENV;
  const child = spawn(process.execPath, [MESA, ...args, "--json"], { env, stdio: ["ignore", "pipe", "pipe"] });
  const code = await new Promise((r) => child.on("close", r));
  server.close();
  return { code, calls };
}

test("ticket reopen posts the transition with its reason", async () => {
  const { code, calls } = await run(["ticket", "reopen", "t6", "--reason", "new push"]);
  assert.equal(code, 0);
  assert.deepEqual(calls, [{ method: "POST", url: "/api/tickets/t6/transition", body: { event: "reopen", by: "claude", reason: "new push" } }]);
});

test("ticket reopen without a reason sends none", async () => {
  const { calls } = await run(["ticket", "reopen", "t6"]);
  assert.deepEqual(calls[0].body, { event: "reopen", by: "claude" });
});

test("ticket reply --ask flags the reply as a question; without it nothing is sent", async () => {
  const asked = await run(["ticket", "reply", "t6", "--body", "¿A o B?", "--ask"]);
  assert.equal(asked.calls[0].body.ask, true);
  const info = await run(["ticket", "reply", "t6", "--body", "listo"]);
  assert.equal(info.calls[0].body.ask, undefined);
});

test("sandbox push posts the ref and the optional sha", async () => {
  const a = await run(["sandbox", "push", "t6"]);
  assert.deepEqual(a.calls, [{ method: "POST", url: "/api/sandbox/push", body: { ref: "t6" } }]);
  const b = await run(["sandbox", "push", "t6", "--sha", "abc123"]);
  assert.deepEqual(b.calls[0].body, { ref: "t6", sha: "abc123" });
});

test("sandbox needs a push command and a ref", async () => {
  assert.equal((await run(["sandbox", "pull", "t6"])).code, 2);
  assert.equal((await run(["sandbox", "push"])).code, 2);
});

test("ticket fold posts the folded refs and the reason to the primary", async () => {
  const { code, calls } = await run(["ticket", "fold", "t24", "t25", "t26", "--why", "mismo pedido de Matt"]);
  assert.equal(code, 0);
  assert.deepEqual(calls, [{ method: "POST", url: "/api/tickets/t24/fold", body: { from: ["t25", "t26"], why: "mismo pedido de Matt", session: "dev-test" } }]);
});

test("ticket fold needs a primary, at least one ref and --why", async () => {
  assert.equal((await run(["ticket", "fold", "t24", "t25"])).code, 2);
  assert.equal((await run(["ticket", "fold", "t24", "--why", "x"])).code, 2);
  assert.equal((await run(["ticket", "fold"])).code, 2);
});

test("ticket unfold posts the ticket to split out of the primary", async () => {
  const { code, calls } = await run(["ticket", "unfold", "t24", "t25"]);
  assert.equal(code, 0);
  assert.deepEqual(calls, [{ method: "POST", url: "/api/tickets/t24/unfold", body: { ticket: "t25" } }]);
  assert.equal((await run(["ticket", "unfold", "t24"])).code, 2);
});

test("calendar list, free, people and refresh make the read calls", async () => {
  assert.deepEqual((await run(["calendar", "list", "--from", "2026-11-09", "--to", "2026-11-16"])).calls, [{ method: "GET", url: "/api/calendar?from=2026-11-09&to=2026-11-16", body: undefined }]);
  assert.deepEqual((await run(["calendar", "list"])).calls[0].url, "/api/calendar");
  assert.deepEqual((await run(["calendar", "free", "--day", "2026-11-12", "--minutes", "45"])).calls[0].url, "/api/calendar/free?day=2026-11-12&minutes=45");
  assert.deepEqual((await run(["calendar", "people"])).calls[0].url, "/api/calendar/people");
  assert.deepEqual((await run(["calendar", "refresh"])).calls, [{ method: "POST", url: "/api/calendar/refresh", body: {} }]);
  assert.equal((await run(["calendar", "nope"])).code, 2);
});

test("calendar propose builds the exact event body and the calendar destination", async () => {
  const { code, calls } = await run(["calendar", "propose", "--title", "Meet con Matt", "--start", "2026-11-12T10:00:00-05:00", "--end", "2026-11-12T10:30:00-05:00", "--invitee", "Matt.R@scoutapp.example", "--ticket", "t118", "--context", "libre el jueves"]);
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/salidas");
  assert.deepEqual(calls[0].body, {
    source: "calendar",
    destination: { kind: "calendar_event", calendar: "primary", invitees: ["matt.r@scoutapp.example"], meet: true, postAs: "Andrés Correa" },
    body: "Título: Meet con Matt\nInicio: 2026-11-12T10:00:00-05:00\nFin: 2026-11-12T10:30:00-05:00\nZona: America/Bogota\nInvitados: matt.r@scoutapp.example\nMeet: sí",
    title: "Evento: Meet con Matt",
    context: "libre el jueves",
    ticketId: "t118",
    ownerSession: "dev-test",
  });
  const solo = await run(["calendar", "propose", "--title", "Bloque", "--start", "2026-11-12T10:00:00-05:00", "--end", "2026-11-12T11:00:00-05:00", "--no-meet", "--description", "Foco"]);
  assert.equal(solo.calls[0].body.body, "Título: Bloque\nInicio: 2026-11-12T10:00:00-05:00\nFin: 2026-11-12T11:00:00-05:00\nZona: America/Bogota\nMeet: no\nDescripción: Foco");
  assert.deepEqual(solo.calls[0].body.destination.invitees, []);
  assert.equal((await run(["calendar", "propose", "--title", "x"])).code, 2); // --start and --end are required
});
