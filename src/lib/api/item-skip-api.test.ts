// API tests for "Saltar": POST /api/items/:id/skip and /unskip, and the upsert / PATCH rules around skippedAt.
import { beforeEach, describe, expect, it } from "vitest";
import { PATCH } from "@/app/api/items/[id]/route";
import { POST as SKIP } from "@/app/api/items/[id]/skip/route";
import { POST as UNSKIP } from "@/app/api/items/[id]/unskip/route";
import { POST as UPSERT } from "@/app/api/items/upsert/route";
import { openDb } from "../db/sqlite";
import type { Item } from "../domain/types";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
});

const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://local${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const input = { source: "basecamp", externalId: "bc:1:100", kind: "message", title: "Matt: tarifa", station: "inbox", waitOn: "you" };
const upsert = async (b: Record<string, unknown> = {}) => (await (await UPSERT(req("POST", "/api/items/upsert", { ...input, ...b }), ctx())).json()) as { item: Item; created: boolean };

describe("POST /api/items/:id/skip and /unskip", () => {
  it("skips an item, survives a sweeper re-upsert, and unskip restores what the caller sends", async () => {
    const { item } = await upsert();
    const res = await SKIP(req("POST", `/api/items/${item.id}/skip`), ctx({ id: item.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: item.id, station: "done", waitOn: "none", skippedAt: expect.any(String) });

    const again = await upsert({ title: "Matt: tarifa (editado)" });
    expect(again).toMatchObject({ created: false, item: { station: "done", waitOn: "none", title: "Matt: tarifa (editado)" } });
    expect(again.item.skippedAt).not.toBeNull();

    const back = await UNSKIP(req("POST", `/api/items/${item.id}/unskip`, { station: "inbox", waitOn: "you" }), ctx({ id: item.id }));
    expect(back.status).toBe(200);
    expect(await back.json()).toMatchObject({ station: "inbox", waitOn: "you", skippedAt: null });
  });

  it("a PATCH to a non-done station clears skippedAt", async () => {
    const { item } = await upsert();
    await SKIP(req("POST", `/api/items/${item.id}/skip`), ctx({ id: item.id }));
    const res = await PATCH(req("PATCH", `/api/items/${item.id}`, { station: "todo", waitOn: "you" }), ctx({ id: item.id }));
    expect(await res.json()).toMatchObject({ station: "todo", skippedAt: null });
  });

  it("404 on an unknown id, 400 on a bad unskip body", async () => {
    expect((await SKIP(req("POST", "/api/items/it_missing/skip"), ctx({ id: "it_missing" }))).status).toBe(404);
    expect((await UNSKIP(req("POST", "/api/items/it_missing/unskip", { station: "inbox", waitOn: "you" }), ctx({ id: "it_missing" }))).status).toBe(404);
    const { item } = await upsert();
    expect((await UNSKIP(req("POST", `/api/items/${item.id}/unskip`, { station: "nowhere", waitOn: "you" }), ctx({ id: item.id }))).status).toBe(400);
  });
});
