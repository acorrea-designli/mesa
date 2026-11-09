import { describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { emitWake } from "../wake/wake";
import { changeFromRequest, publishChange, publishRequest, subscribeChanges, type LiveChange } from "./bus";
import { liveResponse } from "./stream";

async function readFrames(res: Response, until: (text: string) => boolean, timeoutMs = 2000): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (!until(text)) {
    if (Date.now() > deadline) throw new Error(`timeout; got: ${text}`);
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  reader.releaseLock();
  return text;
}

describe("changeFromRequest", () => {
  it("maps mutating API paths to entity changes", () => {
    expect(changeFromRequest("POST", "http://x/api/tasks/ta_1/move")).toEqual({ entityType: "task", entityId: "ta_1", kind: "move" });
    expect(changeFromRequest("POST", "http://x/api/salidas/sa_1/versions")).toEqual({ entityType: "salida", entityId: "sa_1", kind: "versions" });
    expect(changeFromRequest("POST", "http://x/api/tickets")).toEqual({ entityType: "ticket", entityId: "", kind: "created" });
    expect(changeFromRequest("PATCH", "http://x/api/items/it_1")).toEqual({ entityType: "item", entityId: "it_1", kind: "updated" });
    expect(changeFromRequest("POST", "http://x/api/items/upsert")).toEqual({ entityType: "item", entityId: "", kind: "upsert" });
    expect(changeFromRequest("PATCH", "http://x/api/sources/slack")).toEqual({ entityType: "source", entityId: "slack", kind: "updated" });
  });
  it("ignores reads and plumbing", () => {
    expect(changeFromRequest("GET", "http://x/api/tasks")).toBeNull();
    expect(changeFromRequest("POST", "http://x/api/wait/ack")).toBeNull();
    expect(changeFromRequest("POST", "http://x/api/sessions")).toBeNull();
    expect(changeFromRequest("POST", "http://x/api/push/looking")).toBeNull();
    expect(changeFromRequest("POST", "http://x/api/push/subscription")).toBeNull();
  });
  it("publishes only successful requests", () => {
    const seen: LiveChange[] = [];
    const off = subscribeChanges((c) => seen.push(c));
    publishRequest(new Request("http://x/api/tasks/ta_1/move", { method: "POST" }), 409);
    publishRequest(new Request("http://x/api/tasks/ta_1/move", { method: "POST" }), 200);
    off();
    expect(seen).toEqual([{ entityType: "task", entityId: "ta_1", kind: "move" }]);
  });
});

describe("GET /api/stream", () => {
  it("sends ready, then one change frame per change and per wake event, and cleans up on abort", async () => {
    const ac = new AbortController();
    const res = liveResponse(ac.signal, 60_000);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(await readFrames(res, (t) => t.includes("event: ready"))).toMatch(/^retry: 3000/);

    publishChange({ entityType: "salida", entityId: "sa_1", kind: "versions" });
    const db = openDb(":memory:");
    emitWake(db, { sessionId: "lead", kind: "ticket.answered", entityType: "ticket", entityId: "tk_1" });
    const text = await readFrames(res, (t) => t.includes("tk_1"));
    expect(text).toContain(`event: change\ndata: {"entityType":"salida","entityId":"sa_1","kind":"versions"}\n\n`);
    expect(text).toContain(`data: {"entityType":"ticket","entityId":"tk_1","kind":"ticket.answered"}`);

    ac.abort();
    const reader = res.body!.getReader();
    expect((await reader.read()).done).toBe(true);
    // No listener left behind: publishing after abort does not throw.
    publishChange({ entityType: "task", entityId: "x", kind: "move" });
  });

  it("sends heartbeats", async () => {
    const ac = new AbortController();
    const res = liveResponse(ac.signal, 20);
    expect(await readFrames(res, (t) => t.includes(": ping"))).toContain(": ping");
    ac.abort();
  });
});
