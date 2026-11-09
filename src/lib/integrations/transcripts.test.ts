import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { MIN_SCAN_MS, scanTranscripts, sessionsFolder, tokenSummary, transcriptsDir, type TokenState } from "./transcripts";

const e = (o: Record<string, string>) => o as NodeJS.ProcessEnv;
const NOW = new Date("2026-11-09T20:00:00Z"); // Monday, 15:00 in Bogota
let dir: string;

const line = (id: string, at: string, model: string, input: number, output = 0) =>
  JSON.stringify({ type: "assistant", timestamp: at, message: { id, model, usage: { input_tokens: input, output_tokens: output } } }) + "\n";

const put = (rel: string, text: string, mode: "w" | "a" = "w") => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (mode === "a") fs.appendFileSync(p, text);
  else fs.writeFileSync(p, text);
  return p;
};
const fresh = (): TokenState => ({ files: {}, days: {} });
const total = (s: TokenState) => Object.values(s.days).flatMap((d) => Object.values(d)).reduce((n, u) => n + u.input + u.output, 0);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-transcripts-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("scanTranscripts", () => {
  it("reads the lead's file and each subagent's file with the role from its meta", () => {
    put("s1.jsonl", line("a", "2026-11-09T14:00:00Z", "claude-opus-5-5", 10, 5));
    put("s1/subagents/agent-x1.jsonl", line("b", "2026-11-09T15:00:00Z", "claude-haiku-5-5", 3));
    put("s1/subagents/agent-x1.meta.json", JSON.stringify({ agentType: "sweeper", description: "Mesa sweeper-2 ingest loop" }));
    put("s1/subagents/agent-x2.jsonl", line("c", "2026-11-09T15:30:00Z", "claude-opus-5-5", 7));
    put("s1/subagents/agent-x2.meta.json", JSON.stringify({ agentType: "general-purpose", description: "researcher-t9 measure" }));
    const s = fresh();
    expect(scanTranscripts(dir, s, NOW)).toBe(true);
    const day = s.days["2026-11-09"]!;
    expect(Object.keys(day).sort()).toEqual(["lead|claude-opus-5-5", "other|claude-opus-5-5", "sweeper|claude-haiku-5-5"]);
    expect(day["lead|claude-opus-5-5"]).toMatchObject({ input: 10, output: 5 });
  });

  it("is incremental: a second scan reads only the appended lines", () => {
    const f = put("s1.jsonl", line("a", "2026-11-09T14:00:00Z", "claude-opus-5-5", 10));
    const s = fresh();
    scanTranscripts(dir, s, NOW);
    expect(scanTranscripts(dir, s, NOW)).toBe(false); // nothing new
    const offset = s.files["s1.jsonl"]!.offset;
    expect(offset).toBe(fs.statSync(f).size);
    put("s1.jsonl", line("b", "2026-11-09T16:00:00Z", "claude-opus-5-5", 5), "a");
    expect(scanTranscripts(dir, s, NOW)).toBe(true);
    expect(total(s)).toBe(15);
  });

  it("counts a response once however many content-block lines carry it", () => {
    put("s1.jsonl", line("a", "2026-11-09T14:00:00Z", "claude-opus-5-5", 10, 4) + line("a", "2026-11-09T14:00:01Z", "claude-opus-5-5", 10, 4) + line("b", "2026-11-09T14:01:00Z", "claude-opus-5-5", 1));
    const s = fresh();
    scanTranscripts(dir, s, NOW);
    expect(total(s)).toBe(15);
    // The same response again after a rescan boundary is still not counted twice.
    put("s1.jsonl", line("b", "2026-11-09T14:01:01Z", "claude-opus-5-5", 1), "a");
    scanTranscripts(dir, s, NOW);
    expect(total(s)).toBe(15);
  });

  it("leaves a half-written last line for the next scan", () => {
    const whole = line("a", "2026-11-09T14:00:00Z", "claude-opus-5-5", 10);
    const next = line("b", "2026-11-09T14:05:00Z", "claude-opus-5-5", 5);
    put("s1.jsonl", whole + next.slice(0, 30));
    const s = fresh();
    scanTranscripts(dir, s, NOW);
    expect(total(s)).toBe(10);
    put("s1.jsonl", next.slice(30), "a");
    scanTranscripts(dir, s, NOW);
    expect(total(s)).toBe(15);
  });

  it("waits for a subagent's meta instead of filing it under other", () => {
    put("s1/subagents/agent-y.jsonl", line("a", "2026-11-09T14:00:00Z", "claude-opus-5-5", 9));
    const s = fresh();
    scanTranscripts(dir, s, NOW);
    expect(total(s)).toBe(0);
    put("s1/subagents/agent-y.meta.json", JSON.stringify({ agentType: "dev" }));
    scanTranscripts(dir, s, NOW);
    expect(s.days["2026-11-09"]).toHaveProperty(["dev|claude-opus-5-5"]);
  });

  it("skips files untouched since before last week and forgets files that are gone", () => {
    const old = put("old.jsonl", line("a", "2026-10-01T14:00:00Z", "claude-opus-5-5", 99));
    fs.utimesSync(old, new Date("2026-10-01T14:00:00Z"), new Date("2026-10-01T14:00:00Z"));
    const keep = put("keep.jsonl", line("b", "2026-11-09T14:00:00Z", "claude-opus-5-5", 1));
    const s = fresh();
    scanTranscripts(dir, s, NOW);
    expect(Object.keys(s.files)).toEqual(["keep.jsonl"]);
    fs.rmSync(keep);
    expect(scanTranscripts(dir, s, NOW)).toBe(true);
    expect(s.files).toEqual({});
  });

  it("ignores garbage lines and non-assistant lines", () => {
    put("s1.jsonl", "not json\n" + JSON.stringify({ type: "user", message: { usage: { input_tokens: 5 } } }) + "\n" + line("a", "2026-11-09T14:00:00Z", "claude-opus-5-5", 2));
    const s = fresh();
    scanTranscripts(dir, s, NOW);
    expect(total(s)).toBe(2);
  });
});

describe("tokenSummary", () => {
  it("summarizes today and the week, persists the state, and throttles rescans", () => {
    put("s1.jsonl", line("a", "2026-11-09T14:00:00Z", "claude-opus-5-5", 10, 5));
    const db = openDb(":memory:");
    const s = tokenSummary(db, NOW, dir)!;
    expect(s.today.total).toBe(15);
    expect(s.today.byRole.map((r) => r.key)).toEqual(["lead"]);
    const saved = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'usage.tokens'").get() as { value: string }).value) as TokenState;
    expect(saved.files["s1.jsonl"]?.offset).toBeGreaterThan(0);

    put("s1.jsonl", line("b", "2026-11-09T15:00:00Z", "claude-opus-5-5", 5), "a");
    expect(tokenSummary(db, new Date(NOW.getTime() + 1000), dir)!.today.total).toBe(15); // inside the throttle window
    expect(tokenSummary(db, new Date(NOW.getTime() + MIN_SCAN_MS), dir)!.today.total).toBe(20);
  });

  it("is null without a transcripts folder", () => {
    expect(tokenSummary(openDb(":memory:"), NOW, null)).toBeNull();
  });

  it("a later scan from the saved state does not recount", () => {
    put("s1.jsonl", line("a", "2026-11-09T14:00:00Z", "claude-opus-5-5", 10));
    const db = openDb(":memory:");
    tokenSummary(db, NOW, dir);
    const again = tokenSummary(db, new Date(NOW.getTime() + MIN_SCAN_MS), dir)!;
    expect(again.today.total).toBe(10);
  });
});

describe("transcriptsDir", () => {
  it("comes from CLAUDE_CONFIG_DIR and matches the sessions folder's slug ignoring case", () => {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-cfg-"));
    fs.mkdirSync(path.join(cfg, "projects", "G--workSpace-designli"), { recursive: true });
    fs.mkdirSync(path.join(cfg, "projects", "G--WorkSpace-designli-sandbox"), { recursive: true });
    const live = transcriptsDir(e({ CLAUDE_CONFIG_DIR: cfg, MESA_SESSIONS_DIR: "G:/WorkSpace/designli" }), "G:/WorkSpace/designli/ops");
    expect(live).toBe(path.join(cfg, "projects", "G--workSpace-designli"));
    const sbx = transcriptsDir(e({ CLAUDE_CONFIG_DIR: cfg, MESA_ENV: "sandbox" }), "G:/WorkSpace/designli/ops");
    expect(sbx && path.basename(sbx)).toBe("G--WorkSpace-designli-sandbox");
    expect(transcriptsDir(e({ CLAUDE_CONFIG_DIR: cfg, MESA_SESSIONS_DIR: "G:/elsewhere" }), "x")).toBeNull();
    expect(transcriptsDir(e({ MESA_TRANSCRIPTS_DIR: "D:/t" }), "x")).toBe("D:/t");
    fs.rmSync(cfg, { recursive: true, force: true });
  });

  it("the live sessions folder is the parent of the repo, the sandbox one its sibling", () => {
    expect(sessionsFolder(e({}), "G:/WorkSpace/designli/ops").replace(/\\/g, "/")).toBe("G:/WorkSpace/designli");
    expect(sessionsFolder(e({ MESA_ENV: "sandbox" }), "G:/WorkSpace/designli/ops").replace(/\\/g, "/")).toBe("G:/WorkSpace/designli-sandbox");
  });
});
