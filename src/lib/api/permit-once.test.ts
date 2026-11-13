// "Permitir esta vez" (t143 PR5): the one-shot grant over the real routes and repositories. Created only by the
// "approve" decision of Andres on a denied card, derived on the server, bound to caller and session, consumed once, expiring.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as APPROVE } from "@/app/api/approvals/[id]/approve/route";
import { POST as DENY } from "@/app/api/approvals/[id]/deny/route";
import { POST as CONSUME } from "@/app/api/approvals/grants/consume/route";
import { POST as POST_APPROVALS } from "@/app/api/approvals/route";
import { GRANT_TTL_MS } from "../domain/approval-grant";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
const saved = { ...process.env };
let r: Repos;
let ref: string;
let dir: string;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" });
  ref = r.tickets.create({ direction: "andres_asks", title: "Borrar rama", ownerSession: "lead" }).ref;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-once-"));
  process.env.MESA_SETTINGS_LOCAL = path.join(dir, "settings.local.json");
  delete process.env.MESA_ENV;
});
afterEach(() => {
  process.env = { ...saved };
  fs.rmSync(dir, { recursive: true, force: true });
});

const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const post = (body?: unknown) => new Request("http://local/x", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const CMD = "git push origin --delete feat/t143-team-render";
const card = (over: Record<string, unknown> = {}) => ({
  ticketRef: ref,
  agent: "lead",
  role: "lead",
  kind: "denied",
  tool: "Bash",
  summary: "Delete the remote branch",
  detail: `$ ${CMD}`,
  cwd: "G:/WorkSpace/designli",
  reason: "[Remote Branch Deletion]",
  toolInput: { command: CMD, description: "Delete the merged branch" },
  sessionId: "sess-A",
  ...over,
});
const file = async (over?: Record<string, unknown>) => {
  const res = await POST_APPROVALS(post(card(over)), ctx());
  expect(res.status).toBe(201);
  return ((await res.json()) as { approval: { id: string } }).approval.id;
};
const allow = async (id: string) => APPROVE(post({}), ctx({ id }));
const consume = async (over: Record<string, unknown> = {}) => {
  const res = await CONSUME(post({ tool: "Bash", toolInput: { command: CMD, description: "Retry: delete the merged branch" }, caller: "lead", sessionId: "sess-A", ...over }), ctx());
  expect(res.status).toBe(200);
  return (await res.json()) as { granted: boolean; approvalId?: string };
};
type GrantRow = { tool: string; input_hash: string; caller: string; session_id: string; used_at: string | null; expires_at: string; approval_id: string };
const grants = () => r.db.prepare("SELECT * FROM approval_grants").all() as unknown as GrantRow[];

describe("creating a grant", () => {
  it("filing a card and leaving it pending creates nothing; so does a deny", async () => {
    const id = await file();
    expect(grants()).toEqual([]);
    expect((await DENY(post({}), ctx({ id }))).status).toBe(200);
    expect(grants()).toEqual([]);
    expect(await consume()).toEqual({ granted: false });
  });
  it("the allow of Andres stores one grant derived from the stored call, bound to the caller and session, with a short expiry", async () => {
    const id = await file();
    const now = Date.now();
    expect((await allow(id)).status).toBe(200);
    const [gr] = grants();
    expect(grants()).toHaveLength(1);
    expect(gr).toMatchObject({ tool: "Bash", caller: "lead", session_id: "sess-A", used_at: null, approval_id: id });
    expect(gr!.input_hash).toMatch(/^[0-9a-f]{64}$/);
    const ttl = Date.parse(gr!.expires_at) - now;
    expect(ttl).toBeGreaterThan(GRANT_TTL_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(GRANT_TTL_MS + 5_000);
    expect(r.approvals.get(id)).toMatchObject({ status: "decided", decision: "allow", decidedBy: "andres", rule: "" });
  });
  it("a second press on the same card is a 409 and adds no second grant", async () => {
    const id = await file();
    expect((await allow(id)).status).toBe(200);
    expect((await allow(id)).status).toBe(409);
    expect(grants()).toHaveLength(1);
  });
  it("there is no client-sent hash or rule: extra fields on the card or the press change nothing", async () => {
    const res = await POST_APPROVALS(post({ ...card(), inputHash: "x".repeat(64), grant: { tool: "Bash" }, rule: "Bash(*)" }), ctx());
    const id = ((await res.json()) as { approval: { id: string } }).approval.id;
    await APPROVE(post({ hash: "y".repeat(64), caller: "someone", tool: "Bash(*)" }), ctx({ id }));
    const [gr] = grants();
    expect(gr!.caller).toBe("lead");
    expect(gr!.input_hash).not.toMatch(/^x+$|^y+$/);
    expect(r.approvals.get(id).rule).toBe("");
  });
  it("an actor other than Andres cannot create a grant (the repo refuses it)", async () => {
    const id = await file();
    expect(() => r.approvals.decide(id, { decision: "allow", actor: "dev-t143-2" })).toThrow(/solo Andr/);
    expect(grants()).toEqual([]);
  });
  it("a file edit never gets a grant (its path is the derived rule); a card with no rule can only be denied", async () => {
    const id = await file({ tool: "Write", toolInput: { file_path: "C:/outside/x.txt", content: "z" } });
    expect((await allow(id)).status).toBe(409);
    expect(grants()).toEqual([]);
  });
  it("an MCP call gets a grant over its whole input", async () => {
    const id = await file({ tool: "mcp__engram__mem_save", toolInput: { title: "a", content: "b" } });
    expect((await allow(id)).status).toBe(200);
    expect((await consume({ tool: "mcp__engram__mem_save", toolInput: { content: "b", title: "a" } })).granted).toBe(true);
  });
});

describe("a denied SendMessage (t150)", () => {
  const MSG = { to: "tl-t150-2", summary: "READY t150", message: "READY t150 PR https://github.com/acorrea-designli/mesa/pull/59 at abc1234" };
  const send = (over: Record<string, unknown> = {}) => consume({ tool: "SendMessage", toolInput: MSG, caller: "dev-t150-4", sessionId: "sess-A", ...over });
  const fileMsg = (over: Record<string, unknown> = {}) => file({ agent: "dev-t150-4", role: "dev", tool: "SendMessage", toolInput: MSG, reason: "Classifier unavailable", ...over });

  it("Andres allowing it stores one grant over the whole input; the retry passes once with the exact input", async () => {
    const id = await fileMsg();
    expect(r.approvals.get(id)).toMatchObject({ once: true, onceWhy: "", rule: "" });
    expect((await allow(id)).status).toBe(200);
    expect(grants()).toHaveLength(1);
    expect(grants()[0]).toMatchObject({ tool: "SendMessage", caller: "dev-t150-4", session_id: "sess-A", used_at: null });
    expect(await send({ toolInput: { message: MSG.message, to: MSG.to, summary: MSG.summary } })).toEqual({ granted: true, approvalId: id }); // key order does not matter
    expect(grants()[0]!.used_at).toEqual(expect.any(String));
  });
  it("a second identical call is not granted", async () => {
    await allow(await fileMsg());
    expect((await send()).granted).toBe(true);
    expect((await send()).granted).toBe(false);
  });
  it("a different message, recipient or summary is not granted and consumes nothing", async () => {
    await allow(await fileMsg());
    expect((await send({ toolInput: { ...MSG, message: `${MSG.message} ` } })).granted).toBe(false);
    expect((await send({ toolInput: { ...MSG, message: "READY t150 PR other at abc" } })).granted).toBe(false);
    expect((await send({ toolInput: { ...MSG, to: "team-lead" } })).granted).toBe(false);
    expect((await send({ toolInput: { ...MSG, summary: "other" } })).granted).toBe(false);
    expect((await send({ tool: "Bash" })).granted).toBe(false);
    expect((await send({ caller: "tl-t150-2" })).granted).toBe(false);
    expect((await send({ sessionId: "sess-B" })).granted).toBe(false);
    expect(grants()[0]!.used_at).toBeNull();
    expect((await send()).granted).toBe(true);
  });
  it("only Andres creates the grant, and pending or denied cards create none", async () => {
    const id = await fileMsg();
    expect(() => r.approvals.decide(id, { decision: "allow", actor: "dev-t150-4" })).toThrow(/solo Andr/);
    expect(grants()).toEqual([]);
    expect((await DENY(post({}), ctx({ id }))).status).toBe(200);
    expect((await send()).granted).toBe(false);
  });
});

describe("consuming a grant", () => {
  it("lets exactly that call through once: the second time, and any other call, are not granted", async () => {
    const id = await file();
    await allow(id);
    // another command, another tool, another flag: not this call
    expect((await consume({ toolInput: { command: `${CMD} ` } })).granted).toBe(false);
    expect((await consume({ toolInput: { command: "git push origin --delete other" } })).granted).toBe(false);
    expect((await consume({ tool: "PowerShell" })).granted).toBe(false);
    expect((await consume({ toolInput: { command: CMD, dangerouslyDisableSandbox: true } })).granted).toBe(false);
    expect(grants()[0]!.used_at).toBeNull(); // misses consume nothing
    // the measured retry: the description is reworded
    expect(await consume()).toEqual({ granted: true, approvalId: id });
    expect(grants()[0]!.used_at).toEqual(expect.any(String));
    expect(await consume()).toEqual({ granted: false });
    expect(await consume({ toolInput: { command: CMD } })).toEqual({ granted: false });
  });
  it("concurrent retries cannot all match the single grant", async () => {
    await allow(await file());
    const results = await Promise.all(Array.from({ length: 8 }, () => consume()));
    expect(results.filter((x) => x.granted)).toHaveLength(1);
    expect(grants().filter((x) => x.used_at)).toHaveLength(1);
  });
  it("two allowed cards for the same call give two grants, each consumed once", async () => {
    await allow(await file());
    await allow(await file());
    expect((await consume()).granted).toBe(true);
    expect((await consume()).granted).toBe(true);
    expect((await consume()).granted).toBe(false);
  });
  it("is bound to the caller: another agent, or the lead for an agent's grant, gets nothing", async () => {
    await allow(await file({ agent: "dev-t143-2", role: "dev" }));
    expect((await consume({ caller: "lead" })).granted).toBe(false);
    expect((await consume({ caller: "dev-t143" })).granted).toBe(false);
    expect((await consume({ caller: "dev-t143-2" })).granted).toBe(true);
  });
  it("is bound to the session that was denied", async () => {
    await allow(await file());
    expect((await consume({ sessionId: "sess-B" })).granted).toBe(false);
    expect((await consume({ sessionId: "" })).granted).toBe(false);
    expect((await consume({ sessionId: undefined })).granted).toBe(false);
    expect((await consume({ sessionId: "sess-A" })).granted).toBe(true);
  });
  it("expires a few minutes after the decision", async () => {
    await allow(await file());
    const late = new Date(Date.now() + GRANT_TTL_MS + 1000);
    expect(r.approvals.consumeGrant({ tool: "Bash", toolInput: { command: CMD }, caller: "lead", sessionId: "sess-A" }, late)).toEqual({ granted: false });
    const early = new Date(Date.now() + GRANT_TTL_MS - 5000);
    expect(r.approvals.consumeGrant({ tool: "Bash", toolInput: { command: CMD }, caller: "lead", sessionId: "sess-A" }, early).granted).toBe(true);
  });
  it("rejects a malformed question (400) and never matches an empty command", async () => {
    expect((await CONSUME(post({ tool: "Bash" }), ctx())).status).toBe(400);
    expect((await consume({ toolInput: { command: "" } })).granted).toBe(false);
  });
});

// reviewer-t143-4's proof, kept as a regression test: any session can POST /api/approvals, so a card must never show
// text the client chose while the grant is hashed from the stored tool_input.
describe("a forged card shows the call that would be granted", () => {
  const HIDDEN = "git push origin HEAD:main";
  const forged = (over: Record<string, unknown> = {}) =>
    card({ agent: "dev-t143-9", role: "dev", summary: "git status", detail: "$ git status", cwd: "G:/WorkSpace/designli-wt/safe", toolInput: { command: HIDDEN, dangerouslyDisableSandbox: true }, ...over });
  const listed = async (id: string) => {
    const { GET: LIST } = await import("@/app/api/approvals/route");
    const res = await LIST(new Request("http://local/api/approvals"), ctx());
    return ((await res.json()) as { approvals: { id: string; summary: string; detail: string; cwd: string; once: boolean }[] }).approvals.find((a) => a.id === id)!;
  };
  const fileForged = async (over?: Record<string, unknown>) => {
    const res = await POST_APPROVALS(post(forged(over)), ctx());
    expect(res.status).toBe(201);
    return ((await res.json()) as { approval: { id: string; summary: string; detail: string; once: boolean } }).approval;
  };

  it("the card shows the stored command in full, the sandbox flag and no client text", async () => {
    const a = await fileForged();
    const shown = await listed(a.id);
    expect(shown.detail).toBe(`$ ${HIDDEN}\n[sin sandbox: dangerouslyDisableSandbox]`);
    expect(shown.summary).toBe(`Bash: ${HIDDEN} (sin sandbox)`);
    expect(shown.detail).not.toContain("git status");
    expect(shown.cwd).toBe(""); // not part of the call that is hashed, so not shown
    expect(shown.once).toBe(true);
    expect(a.detail).toBe(shown.detail); // the POST answer shows the same
  });
  it("a multi-line command is shown whole", async () => {
    const cmd = "echo one\ngit push origin HEAD:main\n# a long tail " + "x".repeat(300);
    const a = await fileForged({ toolInput: { command: cmd } });
    expect((await listed(a.id)).detail).toBe(`$ ${cmd}`);
  });
  it("an MCP call is shown as its canonical JSON, keys sorted, nested too", async () => {
    const a = await fileForged({ tool: "mcp__engram__mem_save", summary: "harmless", detail: "harmless", toolInput: { title: "t", content: { z: 1, a: [2, { y: 1, b: 2 }] } } });
    const d = (await listed(a.id)).detail;
    expect(d).toBe('{\n  "content": {\n    "a": [\n      2,\n      {\n        "b": 2,\n        "y": 1\n      }\n    ],\n    "z": 1\n  },\n  "title": "t"\n}');
    expect(d).not.toContain("harmless");
  });
  it("the grant a press creates is for exactly the call the card showed", async () => {
    const a = await fileForged();
    expect((await allow(a.id)).status).toBe(200);
    expect((await consume({ tool: "Bash", toolInput: { command: "git status" }, caller: "dev-t143-9", sessionId: "sess-A" })).granted).toBe(false);
    expect((await consume({ tool: "Bash", toolInput: { command: HIDDEN }, caller: "dev-t143-9", sessionId: "sess-A" })).granted).toBe(false); // without the flag the card showed
    expect((await consume({ tool: "Bash", toolInput: { command: HIDDEN, dangerouslyDisableSandbox: true }, caller: "dev-t143-9", sessionId: "sess-A" })).granted).toBe(true);
  });
  it("decide refuses a once-grant when the stored text is not what the server builds (a row edited outside the API)", async () => {
    for (const col of ["detail", "summary"]) {
      const a = await fileForged();
      r.db.prepare(`UPDATE approvals SET ${col} = ? WHERE id = ?`).run("$ git status", a.id);
      expect((await listed(a.id)).once).toBe(false);
      const res = await allow(a.id);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/no muestra exactamente/);
      expect(r.approvals.get(a.id).status).toBe("pending");
    }
    expect(grants()).toEqual([]);
  });
  it("a call too long to be read whole cannot be allowed once", async () => {
    const a = await fileForged({ toolInput: { command: `echo ${"a".repeat(21_000)}` } });
    expect(a.once).toBe(false);
    const res = await allow(a.id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/demasiado larga/);
    expect(grants()).toEqual([]);
  });
  it("a denied SendMessage is a once-card shown as its canonical JSON, and says nothing the stored call does not", async () => {
    const input = { to: "tl-t150-2", summary: "READY t150", message: "READY t150 PR https://x/pull/1 at abc" };
    const a = await fileForged({ tool: "SendMessage", summary: "harmless", detail: "harmless", toolInput: input });
    expect(a.once).toBe(true);
    const shown = await listed(a.id);
    expect(shown.summary).toBe("SendMessage");
    expect(shown.detail).toBe('{\n  "message": "READY t150 PR https://x/pull/1 at abc",\n  "summary": "READY t150",\n  "to": "tl-t150-2"\n}');
    expect(shown.detail).not.toContain("harmless");
  });
  it("only SendMessage, Bash, PowerShell and mcp__* are once-cards; any other tool keeps the old card and says why", async () => {
    for (const tool of ["Read", "Glob", "Agent", "WebFetch"]) {
      const a = await fileForged({ tool, summary: "s", detail: "d", toolInput: { file_path: "C:/x" } });
      expect(a.once).toBe(false);
      expect((await listed(a.id)).detail).toBe("d"); // untouched: no server-built text for them
      expect((await allow(a.id)).status).toBe(409);
      expect(r.approvals.get(a.id).onceWhy).toContain(`no se puede permitir ${tool} una vez`);
    }
    for (const tool of ["Bash", "PowerShell", "SendMessage", "mcp__x__y"]) {
      const a = await fileForged({ tool, toolInput: tool === "Bash" || tool === "PowerShell" ? { command: "ls" } : tool === "SendMessage" ? { to: "x", message: "m" } : { a: 1 } });
      expect(a.once).toBe(true);
      expect(r.approvals.get(a.id).onceWhy).toBe("");
    }
    // a file edit says its own reason, and never gets a grant
    const edit = await fileForged({ tool: "Write", toolInput: { file_path: "C:/outside/x.txt", content: "z" } });
    expect(r.approvals.get(edit.id)).toMatchObject({ once: false, onceWhy: expect.stringContaining("una edición de archivo") });
    expect((await allow(edit.id)).status).toBe(409);
    expect(grants()).toEqual([]);
  });
  it("an ordinary permission card and an Edit card are unchanged (client text kept, no once)", async () => {
    const edit = await fileForged({ tool: "Edit", summary: "Edit G:/WorkSpace/designli-wt/dev-t1/scripts/a.mjs", detail: "--- old\na", toolInput: { file_path: "G:/WorkSpace/designli-wt/dev-t1/scripts/a.mjs", old_string: "a", new_string: "b" } });
    expect(edit.once).toBe(false);
    expect((await listed(edit.id)).detail).toBe("--- old\na");
    const normal = r.approvals.create({ agent: "dev-t1", tool: "Bash", summary: "git status", detail: "$ git status" });
    expect(normal).toMatchObject({ kind: "permission", summary: "git status", detail: "$ git status", once: false });
  });
});

// The dangerous part of a call can hide off screen or behind invisible characters: the shown call must not allow either.
describe("a card cannot hide the dangerous part of the call", () => {
  const listedOne = async (id: string) => {
    const { GET: LIST } = await import("@/app/api/approvals/route");
    const res = await LIST(new Request("http://local/api/approvals"), ctx());
    return ((await res.json()) as { approvals: { id: string; summary: string; detail: string; once: boolean }[] }).approvals.find((a) => a.id === id)!;
  };
  const fileCall = async (command: string) => {
    const res = await POST_APPROVALS(post(card({ agent: "dev-t143-9", role: "dev", toolInput: { command }, summary: "git status", detail: "$ git status" })), ctx());
    return ((await res.json()) as { approval: { id: string } }).approval.id;
  };

  it("60 newlines of padding: the summary carries the line count and the detail is the whole command", async () => {
    const command = `git status${"\n".repeat(60)}git push origin HEAD:main`;
    const id = await fileCall(command);
    const shown = await listedOne(id);
    expect(shown.summary).toBe("Bash (61 líneas): git status …");
    expect(shown.detail).toBe(`$ ${command}`);
    expect(shown.once).toBe(true);
  });
  it("U+202E and U+200B are shown as visible escapes; the grant still matches the raw command only", async () => {
    for (const [ch, esc] of [["\u202E", "\\u{202E}"], ["\u200B", "\\u{200B}"]] as const) {
      const command = `git status ${ch}# git push origin HEAD:main`;
      const id = await fileCall(command);
      const shown = await listedOne(id);
      expect(shown.detail).toBe(`$ git status ${esc}# git push origin HEAD:main`);
      expect(shown.summary).toContain(esc);
      expect(`${shown.summary}${shown.detail}`).not.toContain(ch);
      expect((await allow(id)).status).toBe(200);
      expect((await consume({ tool: "Bash", toolInput: { command: "git status # git push origin HEAD:main" }, caller: "dev-t143-9", sessionId: "sess-A" })).granted).toBe(false);
      expect((await consume({ tool: "Bash", toolInput: { command }, caller: "dev-t143-9", sessionId: "sess-A" })).granted).toBe(true);
    }
  });
});
