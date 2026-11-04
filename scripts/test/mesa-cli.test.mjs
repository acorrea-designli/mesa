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
  assert.deepEqual(calls, [{ method: "POST", url: "/api/tickets/t6/transition", body: { event: "reopen", reason: "new push" } }]);
});

test("ticket reopen without a reason sends none", async () => {
  const { calls } = await run(["ticket", "reopen", "t6"]);
  assert.deepEqual(calls[0].body, { event: "reopen" });
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
