// Every route under /api/salidas that answers with a SalidaDetail carries destinationUrl, so the
// "Abrir destino" link never blinks out after Editar, Programar, a version select, a turn or a cancel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as DETAIL } from "@/app/api/salidas/[id]/route";
import { POST as EDIT } from "@/app/api/salidas/[id]/edit/route";
import { POST as SELECT } from "@/app/api/salidas/[id]/select/route";
import { POST as TRANSITION } from "@/app/api/salidas/[id]/transition/route";
import { POST as TURNS } from "@/app/api/salidas/[id]/turns/route";
import { POST as CANCEL } from "@/app/api/salidas/[id]/turns/[turnId]/cancel/route";
import { POST as VERSIONS } from "@/app/api/salidas/[id]/versions/route";
import { PATCH as STAR } from "@/app/api/salidas/[id]/versions/[n]/route";
import { POST as CREATE } from "@/app/api/salidas/route";
import { openDb } from "@/lib/db/sqlite";
import { createRepos, type Repos } from "@/lib/repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
let id: string;
const URL_OK = "https://designli.slack.com/archives/C0SCOUT01/p1730640660118000";
const DEST = { kind: "slack_thread", workspace: "Designli", channel: "#scout-dev", channelId: "C0SCOUT01", threadTs: "1730640660.118000", postAs: "Andrés" } as const;

beforeEach(() => {
  vi.stubEnv("MESA_ENV", "");
  vi.stubEnv("MESA_SLACK_DOMAIN", "designli");
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  id = r.salidas.create({ source: "slack", destination: { ...DEST }, body: "Listo." }).id;
});
afterEach(() => vi.unstubAllEnvs());

const req = (method: string, body?: unknown) =>
  new Request("http://local/api/salidas", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });
const url = async (res: Response) => {
  expect(res.status).toBeLessThan(300);
  return ((await res.json()) as { destinationUrl?: string | null }).destinationUrl;
};

describe("salida routes answer with destinationUrl", () => {
  it("GET /api/salidas/:id", async () => expect(await url(await DETAIL(req("GET"), ctx({ id })))).toBe(URL_OK));

  it("POST /api/salidas (create)", async () => {
    const res = await CREATE(req("POST", { source: "slack", destination: DEST, body: "Otro." }), ctx({}));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { destinationUrl: string }).destinationUrl).toBe(URL_OK);
  });

  it("POST transition (schedule)", async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    expect(await url(await TRANSITION(req("POST", { type: "schedule", at, version: 1 }), ctx({ id })))).toBe(URL_OK);
  });

  it("POST edit", async () => expect(await url(await EDIT(req("POST", { body: "Mi versión." }), ctx({ id })))).toBe(URL_OK));

  it("POST versions", async () => expect(await url(await VERSIONS(req("POST", { body: "v2 text", author: "claude" }), ctx({ id })))).toBe(URL_OK));

  it("POST select", async () => {
    r.salidas.addVersion(id, { body: "v2 text", author: "claude" });
    expect(await url(await SELECT(req("POST", { n: 1 }), ctx({ id })))).toBe(URL_OK);
  });

  it("PATCH versions/:n (star)", async () => expect(await url(await STAR(req("PATCH", { starred: true }), ctx({ id, n: "1" })))).toBe(URL_OK));

  it("POST turns, then cancel", async () => {
    const res = await TURNS(req("POST", { body: "Más corto" }), ctx({ id }));
    expect(await url(res.clone())).toBe(URL_OK);
    const turn = ((await res.json()) as { turns: { id: string }[] }).turns.at(-1)!;
    expect(await url(await CANCEL(req("POST"), ctx({ id, turnId: turn.id })))).toBe(URL_OK);
  });

  it("is null, not guessed, when the config is missing", async () => {
    vi.stubEnv("MESA_SLACK_DOMAIN", "");
    expect(await url(await EDIT(req("POST", { body: "Mi versión." }), ctx({ id })))).toBeNull();
  });
});
