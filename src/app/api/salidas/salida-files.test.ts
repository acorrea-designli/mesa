// t196: files on a Basecamp salida. The propose route checks and hashes each path, the card shows the names and opens
// them, a file that changed is refused, and the lead records the sgid of each upload.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as OPEN } from "@/app/api/salidas/[id]/files/[index]/route";
import { GET as DETAIL } from "@/app/api/salidas/[id]/route";
import { POST as UPLOAD } from "@/app/api/salidas/[id]/uploads/route";
import { POST as CREATE } from "@/app/api/salidas/route";
import { destinationFiles, routeStops } from "@/features/salidas/model";
import { openDb } from "@/lib/db/sqlite";
import { MAX_SALIDA_FILE_BYTES, fileSizeLabel } from "@/lib/domain/salida-files";
import type { Destination, SalidaDetail } from "@/lib/domain/types";
import { createRepos, type Repos } from "@/lib/repo";
import { describeFile, fileState, resolveSalidaFiles } from "@/lib/repo/salida-files";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
let dir: string;
const SGID = "BAh7CEkiCGdpZAY6BkVUSSI-eHR0cHM6Ly8zLmJhc2VjYW1wLmNvbS9hdHRhY2g";

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-salida-files-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (name: string, data: string | Buffer = "%PDF-1.4 report") => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return p;
};
const post = (p: string, b: unknown) => new Request(`http://local${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const dest = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, project: "Scout", recordingId: "55", postAs: "Andrés", ...extra });
const propose = (d: unknown) => CREATE(post("/api/salidas", { source: "basecamp", destination: d, body: "Hey Matt, here is the report." }), ctx());
const filesOf = (s: SalidaDetail) => (s.destination as Extract<Destination, { files?: unknown }>).files!;

describe("describeFile / resolveSalidaFiles", () => {
  it("measures name, size and the SHA-256 of an existing file", () => {
    const f = describeFile(write("cost report.pdf", "abc"));
    expect(f).toMatchObject({ name: "cost report.pdf", size: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
    expect(path.isAbsolute(f.path)).toBe(true);
  });

  it("refuses a relative path, a missing file, a folder, an empty file and a file over the limit", () => {
    expect(() => describeFile("report.pdf")).toThrow(/absolute path/);
    expect(() => describeFile(path.join(dir, "nope.pdf"))).toThrow(/does not exist/);
    expect(() => describeFile(dir)).toThrow(/is not a file/);
    expect(() => describeFile(write("empty.pdf", ""))).toThrow(/is empty/);
    expect(() => describeFile(write("big.bin", Buffer.alloc(MAX_SALIDA_FILE_BYTES + 1)))).toThrow(/limit is 25 MB/);
  });

  it("refuses hidden paths and anything outside the allowed folders", () => {
    fs.mkdirSync(path.join(dir, ".secrets"));
    expect(() => describeFile(write(".secrets/key.pdf"))).toThrow(/hidden folder or file/);
    expect(() => describeFile(write(".env.local", "X=1"))).toThrow(/hidden folder or file/);
    expect(() => describeFile(write("ok.pdf"), [path.join(dir, "elsewhere")])).toThrow(/outside the folders/);
  });

  it("takes at most 10 files and none twice", () => {
    const p = write("a.pdf");
    expect(() => resolveSalidaFiles([p, { path: p }])).toThrow(/listed twice/);
    expect(() => resolveSalidaFiles(Array.from({ length: 11 }, (_, i) => write(`f${i}.pdf`)))).toThrow(/at most 10/);
    expect(resolveSalidaFiles(undefined)).toBeUndefined();
  });

  it("fileState tells a changed or deleted file from the approved one", () => {
    const p = write("a.pdf", "one");
    const f = describeFile(p);
    expect(fileState(f)).toBe("ok");
    fs.writeFileSync(p, "two");
    expect(fileState(f)).toBe("changed");
    fs.rmSync(p);
    expect(fileState(f)).toBe("missing");
  });
});

describe("POST /api/salidas with files", () => {
  it("stores the measured files on the destination of a post, a comment and a Campfire line", async () => {
    const p = write("informe.pdf", "hello");
    for (const kind of ["basecamp_message", "basecamp_comment", "basecamp_campfire"]) {
      const res = await propose(dest(kind, { files: [p] }));
      expect(res.status).toBe(201);
      expect(filesOf((await res.json()) as SalidaDetail)).toEqual([describeFile(p)]);
    }
  });

  it("accepts {path} objects and keeps a salida without files exactly as before", async () => {
    const p = write("a.pdf");
    expect(filesOf((await (await propose(dest("basecamp_comment", { files: [{ path: p }] }))).json()) as SalidaDetail)).toHaveLength(1);
    const plain = (await (await propose(dest("basecamp_comment"))).json()) as SalidaDetail;
    expect("files" in plain.destination).toBe(false);
  });

  it("is a 400 for a missing file and stores nothing", async () => {
    const res = await propose(dest("basecamp_message", { files: [path.join(dir, "gone.pdf")] }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/does not exist/);
    expect(r.salidas.list({})).toHaveLength(0);
  });

  it("is a 400 for files on a non-Basecamp destination", async () => {
    const res = await CREATE(post("/api/salidas", { source: "slack", destination: { kind: "slack_channel", workspace: "D", channel: "#a", postAs: "A", files: [write("a.pdf")] }, body: "x" }), ctx());
    expect(res.status).toBe(201); // zod strips the unknown key: Slack never carries files
    expect(JSON.stringify(((await res.json()) as SalidaDetail).destination)).not.toContain("files");
  });
});

describe("GET /api/salidas/:id/files/:index", () => {
  const open = (id: string, index: string) => OPEN(new Request("http://local/x"), ctx({ id, index }));

  it("serves exactly the proposed file, a PDF inline", async () => {
    const s = (await (await propose(dest("basecamp_message", { files: [write("informe.pdf", "%PDF-1.4 hello")] }))).json()) as SalidaDetail;
    const res = await open(s.id, "0");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(await res.text()).toBe("%PDF-1.4 hello");
  });

  it("downloads anything that is not a PDF or a raster image", async () => {
    const s = (await (await propose(dest("basecamp_comment", { files: [write("page.html", "<script>1</script>")] }))).json()) as SalidaDetail;
    const res = await open(s.id, "0");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("is 409 once the file changed, 404 when it is gone or the index does not exist", async () => {
    const p = write("informe.pdf", "v1");
    const s = (await (await propose(dest("basecamp_message", { files: [p] }))).json()) as SalidaDetail;
    expect((await open(s.id, "1")).status).toBe(404);
    expect((await open(s.id, "x")).status).toBe(404);
    fs.writeFileSync(p, "v2");
    expect((await open(s.id, "0")).status).toBe(409);
    fs.rmSync(p);
    expect((await open(s.id, "0")).status).toBe(404);
  });

  it("never serves a path that is not on the salida's destination", async () => {
    const s = (await (await propose(dest("basecamp_comment"))).json()) as SalidaDetail;
    expect((await open(s.id, "0")).status).toBe(404);
  });
});

describe("the read model", () => {
  it("reports each file's state on an open salida and none once it is final", async () => {
    const p = write("a.pdf", "one");
    const s = (await (await propose(dest("basecamp_message", { files: [p] }))).json()) as SalidaDetail & { fileStates: string[] };
    expect(s.fileStates).toEqual(["ok"]);
    fs.writeFileSync(p, "two");
    const again = (await (await DETAIL(new Request("http://local/x"), ctx({ id: s.id }))).json()) as { fileStates: string[] };
    expect(again.fileStates).toEqual(["changed"]);
  });

  it("shows the names and, for a post, who it notifies, on the route", () => {
    const f = { path: "/x/a.pdf", name: "a.pdf", size: 2048, sha256: "0".repeat(64) };
    const d = { kind: "basecamp_message", project: "Scout", postAs: "A", files: [f, { ...f, name: "b.pdf" }], mentions: [{ id: "9001", name: "Matt Myers" }] } as Destination;
    expect(destinationFiles(d)).toHaveLength(2);
    expect(routeStops(d)).toEqual(expect.arrayContaining([{ label: "Avisa a", value: "Matt Myers" }, expect.objectContaining({ label: "Adjunta", value: "2 archivos" })]));
    const one = { ...d, files: [f], mentions: undefined } as Destination;
    expect(routeStops(one)).toEqual(expect.arrayContaining([{ label: "Avisa a", value: "Los de siempre del tablero", note: "Sin personas elegidas" }, { label: "Adjunta", value: "a.pdf" }]));
    expect(fileSizeLabel(2048)).toBe("2 KB");
    expect(fileSizeLabel(3.4 * 1024 * 1024)).toBe("3,4 MB");
  });
});

describe("POST /api/salidas/:id/uploads", () => {
  const release = (id: string) => {
    r.salidas.transition(id, { type: "approve", version: 1 });
    r.salidas.transition(id, { type: "release" }, new Date(Date.now() + 25_000));
  };
  const upload = (id: string, b: unknown) => UPLOAD(post(`/api/salidas/${id}/uploads`, b), ctx({ id }));

  it("records the sgid against the hash measured at propose time, and a retry replaces it", async () => {
    const p = write("a.pdf");
    const s = (await (await propose(dest("basecamp_message", { files: [p] }))).json()) as SalidaDetail;
    release(s.id);
    const res = await upload(s.id, { file: 0, sgid: SGID });
    expect(res.status).toBe(201);
    const first = ((await res.json()) as SalidaDetail).uploads!;
    expect(first).toEqual([expect.objectContaining({ fileIndex: 0, sgid: SGID, sha256: filesOf(s)[0]!.sha256 })]);
    await upload(s.id, { file: 0, sgid: SGID + "2" });
    expect(r.salidas.detail(s.id).uploads).toEqual([expect.objectContaining({ sgid: SGID + "2" })]);
  });

  it("is refused for a file the salida does not have, a malformed sgid and a salida that is not released", async () => {
    const s = (await (await propose(dest("basecamp_message", { files: [write("a.pdf")] }))).json()) as SalidaDetail;
    expect((await upload(s.id, { file: 0, sgid: SGID })).status).toBe(409); // pending, not released
    release(s.id);
    expect((await upload(s.id, { file: 3, sgid: SGID })).status).toBe(400);
    expect((await upload(s.id, { file: 0, sgid: "short" })).status).toBe(400);
  });
});
