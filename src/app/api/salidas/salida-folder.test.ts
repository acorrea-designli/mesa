// t87: "Abrir carpeta" on a salida that carries files. POST /api/salidas/:id/files/:index/folder launches the file manager
// on Andrés's PC: local requests only, only a path stored on that salida's own destination.files, only inside the allowed roots.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revealFile = vi.fn();
vi.mock("@/lib/repo/reveal-file", async (orig) => ({ ...(await orig<typeof import("@/lib/repo/reveal-file")>()), revealFile: (p: string) => revealFile(p) }));

import { POST as FOLDER } from "@/app/api/salidas/[id]/files/[index]/folder/route";
import { POST as CREATE } from "@/app/api/salidas/route";
import { openDb } from "@/lib/db/sqlite";
import type { SalidaDetail } from "@/lib/domain/types";
import { createRepos, type Repos } from "@/lib/repo";
import { revealCommand } from "@/lib/repo/reveal-file";
import { describeFile } from "@/lib/repo/salida-files";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
let dir: string;

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-salida-folder-"));
  revealFile.mockReset();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (name: string, data = "%PDF-1.4 report") => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return p;
};
const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const dest = (extra: Record<string, unknown> = {}) => ({ kind: "basecamp_message", project: "DRE", recordingId: "55", subject: "AWS cost report", postAs: "Andrés", ...extra });
const propose = async (files: string[]) =>
  (await (await CREATE(new Request("http://local/api/salidas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "basecamp", destination: dest({ files }), body: "Hey Matt." }) }), ctx())).json()) as SalidaDetail;
const LOCAL = { host: "localhost:8790" };
const open = (id: string, index: string, headers: Record<string, string> = LOCAL) =>
  FOLDER(new Request(`http://localhost:8790/api/salidas/${id}/files/${index}/folder`, { method: "POST", headers }), ctx({ id, index }));

describe("POST /api/salidas/:id/files/:index/folder", () => {
  it("opens the folder of exactly the file stored on the salida, for a request from this PC", async () => {
    const p = write("DRE AWS cost report.pdf");
    const s = await propose([p, write("other.pdf")]);
    const res = await open(s.id, "0");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ opened: "DRE AWS cost report.pdf" });
    expect(revealFile).toHaveBeenCalledOnce();
    expect(revealFile).toHaveBeenCalledWith(fs.realpathSync(p));
    await open(s.id, "1");
    expect(revealFile).toHaveBeenLastCalledWith(fs.realpathSync(path.join(dir, "other.pdf")));
  });

  it("refuses anything that does not come from the PC itself: no Host, a tunnel's headers, a forwarded address", async () => {
    const s = await propose([write("a.pdf")]);
    for (const headers of [{} as Record<string, string>, { host: "mesa.example.com" }, { ...LOCAL, "cf-connecting-ip": "203.0.113.9" }, { ...LOCAL, "x-forwarded-for": "203.0.113.9" }, { ...LOCAL, "cf-access-jwt-assertion": "x" }]) {
      const res = await open(s.id, "0", headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    expect(revealFile).not.toHaveBeenCalled();
  });

  it("takes no path from the request: only a file index of this salida, and only an existing one", async () => {
    const s = await propose([write("a.pdf")]);
    for (const index of ["1", "-1", "0x0", "../0", "abc"]) expect((await open(s.id, index)).status, index).toBe(404);
    expect((await open("sa_nope", "0")).status).toBe(404);
    const plain = r.salidas.create({ source: "basecamp", destination: { kind: "basecamp_comment", project: "DRE", recordingId: "5", postAs: "A" }, body: "x" });
    expect((await open(plain.id, "0")).status).toBe(404);
    expect(revealFile).not.toHaveBeenCalled();
  });

  it("refuses a stored path that is outside the allowed folders or hidden, and says when the file is gone", async () => {
    // A row written some other way (the propose route never stores this) still cannot launch a folder outside the roots.
    const outside = path.join(process.cwd(), "package.json");
    const s = r.salidas.create({ source: "basecamp", destination: dest({ files: [{ path: outside, name: "package.json", size: 1, sha256: "0".repeat(64) }] }) as never, body: "x" });
    expect((await open(s.id, "0")).status).toBe(403);
    const real = await propose([write("gone.pdf")]);
    fs.rmSync(path.join(dir, "gone.pdf"));
    expect((await open(real.id, "0")).status).toBe(404);
    expect(revealFile).not.toHaveBeenCalled();
  });

  it("still opens the folder of a file that changed after it was proposed (nothing is read or sent)", async () => {
    const p = write("a.pdf");
    const s = await propose([p]);
    fs.writeFileSync(p, "changed");
    expect(describeFile(p).sha256).not.toBe((s.destination as { files: { sha256: string }[] }).files[0]!.sha256);
    expect((await open(s.id, "0")).status).toBe(200);
  });
});

describe("revealCommand", () => {
  it("Windows: Explorer with the file selected, the command line passed verbatim (spaces survive)", () => {
    expect(revealCommand("win32", "C:\\tmp\\DRE AWS cost report.pdf")).toEqual({ cmd: "explorer.exe", args: ['/select,"C:\\tmp\\DRE AWS cost report.pdf"'], verbatim: true });
    expect(revealCommand("win32", "C:/tmp/a b.pdf").args[0]).toBe('/select,"C:\\tmp\\a b.pdf"');
  });

  it("refuses a Windows path with a double quote instead of building a command from it", () => {
    expect(() => revealCommand("win32", 'C:\\tmp\\a" /x.pdf')).toThrow(/double quote/);
  });

  it("macOS reveals the file, Linux opens its folder", () => {
    expect(revealCommand("darwin", "/tmp/a b.pdf")).toEqual({ cmd: "open", args: ["-R", "/tmp/a b.pdf"], verbatim: false });
    expect(revealCommand("linux", "/tmp/a b.pdf")).toEqual({ cmd: "xdg-open", args: ["/tmp"], verbatim: false });
  });
});
