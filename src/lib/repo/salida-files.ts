// Server side of t196: validate the local files a Basecamp salida carries, measure them, and re-check them later.
// Node fs only here; the pure types and labels are in domain/salida-files.ts.
import { createHash } from "node:crypto";
import { realpathSync, statSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { ValidationError } from "@/lib/db/util";
import { MAX_SALIDA_FILE_BYTES, MAX_SALIDA_FILES, type FileState, type SalidaFile } from "@/lib/domain/salida-files";

const sameCase = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/** Where a salida's files may live: the owner's home, the temp folder (the writer's scratch), Mesa's own folder and MESA_FILE_ROOTS. */
export function allowedRoots(env: Record<string, string | undefined> = process.env): string[] {
  const extra = (env.MESA_FILE_ROOTS ?? "").split(path.delimiter).filter(Boolean);
  return [homedir(), tmpdir(), process.cwd(), ...extra].flatMap((r) => {
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
    throw new ValidationError(`file "${raw}" is outside the folders Mesa may attach from (your home, the temp folder, Mesa's folder; MESA_FILE_ROOTS adds more)`);
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

/** Is the file on disk still the approved one? Reads the bytes, so call it for open salidas only. */
export function fileState(f: SalidaFile): FileState {
  try {
    return sha256File(f.path) === f.sha256 ? "ok" : "changed";
  } catch {
    return "missing";
  }
}
