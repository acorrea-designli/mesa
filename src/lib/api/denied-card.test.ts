// "Bloqueado por el modo automático" (t128 part H): the denied-call card over the real routes and repositories. The
// rule is derived on the server from the stored call; the settings file is written only on "Permitir esta regla".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as APPROVE } from "@/app/api/approvals/[id]/approve/route";
import { POST as DENY } from "@/app/api/approvals/[id]/deny/route";
import { POST as READ_CONFIG } from "@/app/api/approvals/[id]/read-config/route";
import { POST as POST_APPROVALS } from "@/app/api/approvals/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
const saved = { ...process.env };
let r: Repos;
let ref: string;
let dir: string;
let settings: string;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" });
  ref = r.tickets.create({ direction: "andres_asks", title: "Recurrencia", ownerSession: "lead" }).ref;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-denied-"));
  settings = path.join(dir, "settings.local.json");
  process.env.MESA_SETTINGS_LOCAL = settings;
  delete process.env.MESA_WORKTREES_ROOT;
  delete process.env.MESA_ENV;
});
afterEach(() => {
  process.env = { ...saved };
  fs.rmSync(dir, { recursive: true, force: true });
});

const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const req = (body?: unknown) => new Request("http://local/x", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const FILE = "G:/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/calendar-body.mjs";
const RULE = "Edit(//g/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/**)";
const file = (over: Record<string, unknown> = {}) => ({
  ticketRef: ref,
  agent: "dev-t128-2",
  kind: "denied",
  tool: "Edit",
  summary: `Edit ${FILE}`,
  detail: "--- old\na\n+++ new\nb",
  cwd: "G:/WorkSpace/designli",
  reason: "[Self-Modification]",
  toolInput: { file_path: FILE, old_string: "a", new_string: "b" },
  ...over,
});
const file_ = async (over?: Record<string, unknown>) => {
  const res = await POST_APPROVALS(req(file(over)), ctx());
  expect(res.status).toBe(201);
  return ((await res.json()) as { approval: { id: string; rule: string; kind: string } }).approval;
};
const written = () => (fs.existsSync(settings) ? (JSON.parse(fs.readFileSync(settings, "utf8")) as { permissions?: { allow?: string[] } }).permissions?.allow ?? [] : null);

describe("filing a denied card", () => {
  it("stores the call, the reason and the rule the server derived", async () => {
    const a = await file_();
    expect(a).toMatchObject({ kind: "denied", rule: RULE });
    expect(r.approvals.get(a.id)).toMatchObject({ kind: "denied", reason: "[Self-Modification]", rule: RULE, status: "pending", ticketRef: ref });
    expect(JSON.parse(r.approvals.get(a.id).deniedInput)).toMatchObject({ file_path: FILE });
  });
  it("ignores a rule sent by the client", async () => {
    const res = await POST_APPROVALS(req({ ...file({ toolInput: { file_path: "G:/WorkSpace/designli/ops/src/a.ts" } }), rule: "Edit(**)" }), ctx());
    expect(res.status).toBe(201);
    const a = ((await res.json()) as { approval: { rule: string } }).approval;
    expect(a.rule).toBe("");
  });
  it("files a card with no rule for a Bash call or a path outside the worktrees, and a normal card stays kind permission", async () => {
    expect((await file_({ tool: "Bash", summary: "rm x", toolInput: { command: "rm x" } })).rule).toBe("");
    expect((await file_({ toolInput: { file_path: "G:/WorkSpace/designli/.claude/settings.json" } })).rule).toBe("");
    const normal = r.approvals.create({ agent: "dev-t1", tool: "Bash", summary: "git status" });
    expect(normal).toMatchObject({ kind: "permission", rule: "", reason: "", deniedInput: "" });
  });
  it("needs the denied call for a denied card (400)", async () => {
    expect((await POST_APPROVALS(req(file({ toolInput: undefined })), ctx())).status).toBe(400);
  });
});

describe("Permitir esta regla (approve)", () => {
  it("writes the derived rule to settings.local.json, keeps the rest and records who and when", async () => {
    fs.writeFileSync(settings, JSON.stringify({ env: { A: "1" }, permissions: { allow: ["Bash(node x)"] } }, null, 2));
    const a = await file_();
    expect(written()).toEqual(["Bash(node x)"]); // filing the card writes nothing
    const res = await APPROVE(req({}), ctx({ id: a.id }));
    expect(res.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(settings, "utf8"))).toEqual({ env: { A: "1" }, permissions: { allow: ["Bash(node x)", RULE] } });
    expect(r.approvals.get(a.id)).toMatchObject({ status: "decided", decision: "allow", decidedBy: "andres", rule: RULE, decidedAt: expect.any(String) });
  });
  it("is idempotent: a second press is a 409 and writes nothing; another card for the same rule adds no duplicate", async () => {
    const a = await file_();
    expect((await APPROVE(req({}), ctx({ id: a.id }))).status).toBe(200);
    const once = fs.readFileSync(settings, "utf8");
    expect((await APPROVE(req({}), ctx({ id: a.id }))).status).toBe(409);
    const b = await file_({ toolInput: { file_path: "G:/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/other.mjs" } });
    expect((await APPROVE(req({}), ctx({ id: b.id }))).status).toBe(200);
    expect(fs.readFileSync(settings, "utf8")).toBe(once);
    expect(written()).toEqual([RULE]);
  });
  it("refuses a call with no derivable rule (409) and writes nothing; the card stays pending", async () => {
    for (const over of [
      { tool: "Bash", toolInput: { command: "rm x" } },
      { toolInput: { file_path: "G:/WorkSpace/designli/.claude/settings.json" } },
      { toolInput: { file_path: "G:/WorkSpace/designli-wt/dev-t128-2/package.json" } },
    ]) {
      const a = await file_(over);
      const res = await APPROVE(req({}), ctx({ id: a.id }));
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/no se puede proponer una regla/);
      expect(r.approvals.get(a.id).status).toBe("pending");
    }
    expect(written()).toBeNull();
  });
  it("allows only the rule that was on the card: a changed worktrees folder, a card with no rule and an edited row are refused", async () => {
    // The worktrees folder changed after the card was filed: the call no longer derives a rule.
    const a = await file_();
    process.env.MESA_WORKTREES_ROOT = "D:/other";
    expect((await APPROVE(req({}), ctx({ id: a.id }))).status).toBe(409);
    delete process.env.MESA_WORKTREES_ROOT;
    expect(r.approvals.get(a.id).status).toBe("pending");
    // A card filed with no rule (the folder was different then) is not allowed once the call derives one now.
    process.env.MESA_WORKTREES_ROOT = "D:/other";
    const noRule = await file_();
    expect(noRule.rule).toBe("");
    delete process.env.MESA_WORKTREES_ROOT;
    const res = await APPROVE(req({}), ctx({ id: noRule.id }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/no tenía una regla propuesta/);
    // A stored rule that is not what the call derives (a row edited outside the API).
    r.db.prepare("UPDATE approvals SET rule = ? WHERE id = ?").run("Edit(//g/WorkSpace/designli-wt/dev-t128-2/**)", a.id);
    const mismatch = await APPROVE(req({}), ctx({ id: a.id }));
    expect(mismatch.status).toBe(409);
    expect(((await mismatch.json()) as { error: { message: string } }).error.message).toMatch(/ya no coincide/);
    expect(written()).toBeNull();
    for (const id of [a.id, noRule.id]) expect(r.approvals.get(id).status).toBe("pending");
  });
  it("leaves the card pending and the file untouched when the settings file is not JSON", async () => {
    fs.writeFileSync(settings, "{ nope");
    const a = await file_();
    expect((await APPROVE(req({}), ctx({ id: a.id }))).status).toBe(409);
    expect(fs.readFileSync(settings, "utf8")).toBe("{ nope");
    expect(r.approvals.get(a.id).status).toBe("pending");
  });
  it("is refused after the card expired", async () => {
    const a = await file_({ expiresAt: new Date(Date.now() + 200).toISOString() });
    await new Promise((ok) => setTimeout(ok, 300));
    expect((await APPROVE(req({}), ctx({ id: a.id }))).status).toBe(409);
    expect(written()).toBeNull();
  });
  it("is refused on the sandbox board with no explicit path", async () => {
    delete process.env.MESA_SETTINGS_LOCAL;
    process.env.MESA_ENV = "sandbox";
    const a = await file_();
    expect((await APPROVE(req({}), ctx({ id: a.id }))).status).toBe(409);
    expect(r.approvals.get(a.id).status).toBe("pending");
  });
});

describe("Denegar and the other buttons", () => {
  it("deny writes nothing and records the note", async () => {
    const a = await file_();
    expect((await DENY(req({ note: "no" }), ctx({ id: a.id }))).status).toBe(200);
    expect(r.approvals.get(a.id)).toMatchObject({ status: "decided", decision: "deny", note: "no", rule: RULE });
    expect(written()).toBeNull();
  });
  it("a denied card cannot be answered with Lee tus configuraciones", async () => {
    const a = await file_();
    expect((await READ_CONFIG(req({}), ctx({ id: a.id }))).status).toBe(409);
    expect(r.approvals.get(a.id).status).toBe("pending");
  });
  it("a normal permission card is still allowed without touching any settings file", async () => {
    const p = r.approvals.create({ ticketRef: ref, agent: "dev-t1", tool: "Bash", summary: "git status" });
    expect((await APPROVE(req({}), ctx({ id: p.id }))).status).toBe(200);
    expect(written()).toBeNull();
  });
});
