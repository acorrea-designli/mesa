import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fake Mesa: routes "METHOD /path" (query string included) to handlers returning [status, json] or json.
// Throws for unknown routes like an unreachable server would. Records every call.
export function fakeMesa(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? "GET"} ${u.pathname}${u.search}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined });
    const handler = routes[key] ?? routes[`${init.method ?? "GET"} ${u.pathname}`];
    if (!handler) throw new TypeError("fetch failed");
    const r = typeof handler === "function" ? handler(calls.at(-1)) : handler;
    const [status, json] = Array.isArray(r) ? r : [200, r];
    return { ok: status < 400, status, json: async () => json };
  };
  return { fetchImpl, calls };
}

export const unreachable = async () => {
  throw new TypeError("fetch failed");
};

// A session dir with a subagent transcript + meta, the layout Claude Code writes.
export function fakeAgent({ name, agentId = "a0123456789abcdef", lines = [], prompt } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mesa-hook-test-"));
  const session = "sess-1";
  const sub = join(dir, session, "subagents");
  mkdirSync(sub, { recursive: true });
  const transcript = join(dir, `${session}.jsonl`);
  writeFileSync(transcript, "");
  const agentFile = join(sub, `agent-${agentId}.jsonl`);
  const first = { type: "user", message: { role: "user", content: prompt ?? (name ? `You are \`${name}\`.\nTicket: x` : "hello") } };
  writeFileSync(agentFile, [first, ...lines].map((l) => JSON.stringify(l)).join("\n") + "\n");
  if (name) writeFileSync(agentFile.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({ name }));
  return { input: { session_id: session, transcript_path: transcript, agent_id: agentId }, dir, agentFile };
}

export const said = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
export const sent = (message) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "SendMessage", input: { to: "team-lead", message } }] },
});
