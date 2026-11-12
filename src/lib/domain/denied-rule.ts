// The allow rule a "Bloqueado por el modo automático" card proposes (t128 part H), pure.
//
// Auto mode denied a call and the PermissionDenied hook filed a card. Allowing the card adds ONE rule to
// settings.local.json, and the rule is always derived here, on the server, from the stored call. It is never a rule sent
// by a client and never broader than the directory of the file that was denied:
//
//   Edit / Write / MultiEdit / NotebookEdit on G:/WorkSpace/designli-wt/<worktree>/<dir>/<file>
//     -> Edit(//g/WorkSpace/designli-wt/<worktree>/<dir>/**)
//
// `Edit(...)` rules cover Write, MultiEdit and NotebookEdit, and on Windows a path is matched in POSIX form
// (G:\x -> /g/x), so `//g/...` is the absolute form (https://code.claude.com/docs/en/permissions.md, "Read and Edit").
// No rule at all (the card then only offers Denegar, with the reason) for: a path outside the worktrees folder, a
// `..` segment, anything under a protected folder (`.git`, `.config/git`, `.vscode`, `.idea`, `.husky`, `.cargo`,
// `.devcontainer`, `.yarn`, `.mvn`, `.claude`: the list in https://code.claude.com/docs/en/permission-modes.md
// "Protected paths", where an allow rule would not pre-approve the write anyway), a settings*.json file, a file in a worktree's root, a name with a
// glob or rule metacharacter, and every tool that is not a file edit (Bash, PowerShell, MCP, Read...).

/** Where the team's worktrees live. MESA_WORKTREES_ROOT overrides it (tests, another machine). */
export const DEFAULT_WORKTREES_ROOT = "G:/WorkSpace/designli-wt";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** A path segment that can be written into a rule as is: no glob, bracket, comma, quote or space. */
const SAFE_SEGMENT = /^[A-Za-z0-9._@+-]+$/;
/** The folders the docs list as protected paths (writes there go to the classifier whatever the allow rules say). */
const PROTECTED_DIRS = new Set([".git", ".vscode", ".idea", ".husky", ".cargo", ".devcontainer", ".yarn", ".mvn", ".claude"]);

/** True when the segments pass through a protected folder (`.config/git` is a pair). Case-insensitive, like Windows. */
const inProtectedDir = (segs: string[]): boolean => segs.some((x, i) => PROTECTED_DIRS.has(x.toLowerCase()) || (x.toLowerCase() === ".config" && segs[i + 1]?.toLowerCase() === "git"));

export type DeniedRule = { ok: true; rule: string; dir: string } | { ok: false; why: string };

const no = (why: string): DeniedRule => ({ ok: false, why });

/** "G:\a\b", "G:/a/b" or "/g/a/b" -> ["G:", "a", "b"] (drive first); null when it is not an absolute drive path. */
function segments(p: string): string[] | null {
  let s = p.trim().replace(/\\/g, "/");
  const posix = /^\/([A-Za-z])\/(.*)$/.exec(s);
  if (posix) s = `${posix[1]!.toUpperCase()}:/${posix[2]}`;
  if (!/^[A-Za-z]:\//.test(s)) return null;
  const parts = s.split("/");
  const drive = parts[0]!.toUpperCase();
  const rest = parts.slice(1).filter((x) => x !== "" && x !== ".");
  return [drive, ...rest];
}

export function deniedRule(tool: string, toolInput: unknown, root: string = DEFAULT_WORKTREES_ROOT): DeniedRule {
  if (!EDIT_TOOLS.has(tool)) return no("Solo se propone una regla para ediciones de archivos (Edit, Write, MultiEdit, NotebookEdit); una orden o una herramienta MCP no tiene regla.");
  const ti = (toolInput && typeof toolInput === "object" ? toolInput : {}) as Record<string, unknown>;
  const raw = tool === "NotebookEdit" ? ti.notebook_path : ti.file_path;
  if (typeof raw !== "string" || !raw.trim()) return no("La llamada no trae la ruta del archivo.");
  const file = segments(raw);
  const base = segments(root);
  if (!file) return no("La ruta no es absoluta.");
  if (!base) return no("La carpeta de worktrees no está bien configurada.");
  if (file.includes("..")) return no("La ruta tiene «..».");
  const inside = file.length > base.length && base.every((b, i) => b.toLowerCase() === file[i]!.toLowerCase());
  if (!inside) return no(`La ruta está fuera de ${root}.`);
  const rel = file.slice(base.length); // [worktree, ...dirs, file]
  if (rel.length < 3) return no("El archivo está en la raíz de un worktree: una regla ahí cubriría todo el worktree.");
  if (rel.some((x) => !SAFE_SEGMENT.test(x))) return no("La ruta tiene un carácter que no se puede escribir en una regla (comodín, corchete, paréntesis o espacio).");
  if (inProtectedDir(rel)) return no("Las carpetas protegidas (.git, .config/git, .vscode, .idea, .husky, .cargo, .devcontainer, .yarn, .mvn, .claude) nunca llevan regla.");
  if (/^settings.*\.json$/i.test(rel[rel.length - 1]!)) return no("Los archivos settings*.json nunca llevan regla.");
  const dir = `${base[0]!.slice(0, 1).toLowerCase()}/${[...base.slice(1), ...rel.slice(0, -1)].join("/")}`;
  return { ok: true, rule: `Edit(//${dir}/**)`, dir };
}

/** True for exactly the rules `deniedRule` can produce under `root`: the last check before a rule is written. */
export function isDerivedRule(rule: string, root: string = DEFAULT_WORKTREES_ROOT): boolean {
  const base = segments(root);
  if (!base) return false;
  const prefix = `Edit(//${base[0]!.slice(0, 1).toLowerCase()}/${base.slice(1).join("/")}/`;
  if (!rule.startsWith(prefix) || !rule.endsWith("/**)")) return false;
  const inner = rule.slice(prefix.length, -"/**)".length).split("/");
  return inner.length >= 2 && inner.every((x) => SAFE_SEGMENT.test(x) && x !== "." && x !== "..") && !inProtectedDir(inner);
}
