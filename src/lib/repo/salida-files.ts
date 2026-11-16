// Server side of t196: validate the local files a Basecamp salida carries, measure them, and re-check them later.
// Node fs only here; the pure types and labels are in domain/salida-files.ts.
import { createHash } from "node:crypto";
import { realpathSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/db/util";
import { MAX_SALIDA_FILE_BYTES, MAX_SALIDA_FILES, type FileState, type SalidaFile } from "@/lib/domain/salida-files";

const sameCase = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * Where a salida's files may live: the temp folder (the writer's scratch), Mesa's data/uploads (a ticket's attachments)
 * and MESA_FILE_ROOTS. Never the home folder or Mesa's checkout: credentials and .env files live there and the open
 * route serves what propose accepts.
 */
export function allowedRoots(env: Record<string, string | undefined> = process.env): string[] {
  const extra = (env.MESA_FILE_ROOTS ?? "").split(path.delimiter).filter(Boolean);
  return [tmpdir(), path.join(process.cwd(), "data", "uploads"), ...extra].flatMap((r) => {
    try {
      return [realpathSync(r)];
    } catch {
      return [];
    }
  });
}

const inside = (root: string, file: string) => {
  const rel = path.relative(sameCase(root), sameCase(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

export const sha256File = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

/**
 * Validates one path for a salida: absolute, an existing regular file, no hidden folder or file in the path (.env, .ssh,
 * .claude: those hold secrets), inside an allowed root, within the size limit. Returns the stored form.
 */
export function describeFile(raw: string, roots = allowedRoots()): SalidaFile {
  if (!path.isAbsolute(raw)) throw new ValidationError(`file "${raw}": use an absolute path`);
  let real: string;
  let size: number;
  try {
    real = realpathSync(raw);
    const st = statSync(real);
    if (!st.isFile()) throw new ValidationError(`file "${raw}" is not a file`);
    size = st.size;
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError(`file "${raw}" does not exist`);
  }
  if (real.split(/[\\/]+/).some((seg) => seg.startsWith(".") && seg !== "." && seg !== "..")) {
    throw new ValidationError(`file "${raw}": a path with a hidden folder or file (.something) cannot be attached`);
  }
  if (!roots.some((r) => inside(r, real))) {
    throw new ValidationError(`file "${raw}" is outside the folders Mesa may attach from (the temp folder and data/uploads; MESA_FILE_ROOTS adds more)`);
  }
  if (size === 0) throw new ValidationError(`file "${raw}" is empty`);
  if (size > MAX_SALIDA_FILE_BYTES) throw new ValidationError(`file "${raw}" is ${Math.round(size / 1048576)} MB; the limit is ${MAX_SALIDA_FILE_BYTES / 1048576} MB`);
  return { path: real, name: path.basename(real), size, sha256: sha256File(real) };
}

/** The paths of a destination's `files` (strings or {path}) resolved to the stored form; at most MAX_SALIDA_FILES, no duplicates. */
export function resolveSalidaFiles(files: readonly (string | { path: string })[] | undefined): SalidaFile[] | undefined {
  if (!files?.length) return undefined;
  if (files.length > MAX_SALIDA_FILES) throw new ValidationError(`at most ${MAX_SALIDA_FILES} files per salida`);
  const roots = allowedRoots();
  const out = files.map((f) => describeFile(typeof f === "string" ? f : f.path, roots));
  const seen = new Set<string>();
  for (const f of out) {
    const k = sameCase(f.path);
    if (seen.has(k)) throw new ValidationError(`file "${f.path}" is listed twice`);
    seen.add(k);
  }
  return out;
}

/**
 * The real path of a stored file Mesa may reveal in the file manager (t87, "Abrir carpeta"): it must still exist as a
 * regular file, sit in no hidden folder and inside an allowed root. The bytes are not read: opening a folder discloses
 * nothing, and Andrés may want to see a file that changed. Throws NotFoundError (gone) or ForbiddenError (outside).
 */
export function revealablePath(f: SalidaFile, roots = allowedRoots()): string {
  let real: string;
  try {
    real = realpathSync(f.path);
    if (!statSync(real).isFile()) throw new Error("not a file");
  } catch {
    throw new NotFoundError("file on disk", f.name);
  }
  const hidden = real.split(/[\\/]+/).some((seg) => seg.startsWith(".") && seg !== "." && seg !== "..");
  if (hidden || !roots.some((r) => inside(r, real))) throw new ForbiddenError("this file is outside the folders Mesa may open");
  return real;
}

/** The file's bytes when they still hash to the approved SHA-256: read once, so what is checked is what the caller uses. */
export function approvedBytes(f: SalidaFile): { state: "ok"; data: Buffer } | { state: "changed" } | { state: "missing" } {
  let data: Buffer;
  try {
    data = readFileSync(f.path);
  } catch {
    return { state: "missing" };
  }
  return createHash("sha256").update(data).digest("hex") === f.sha256 ? { state: "ok", data } : { state: "changed" };
}

/** Is the file on disk still the approved one? Reads the bytes, so call it for open salidas only. */
export function fileState(f: SalidaFile): FileState {
  return approvedBytes(f).state;
}
