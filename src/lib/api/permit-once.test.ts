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
