// Appends one allow rule to the sessions folder's settings.local.json (t128 part H). Only the Mesa server calls this,
// only after Andrés pressed "Permitir esta regla" on a card, and only with a rule `deniedRule` derived on the server.
// It keeps the rest of the JSON, never duplicates a rule and writes atomically (temp file in the same folder, then
// rename). A file that does not parse is never overwritten.
import fs from "node:fs";
import path from "node:path";
import { TransitionError } from "../db/util";
import { DEFAULT_WORKTREES_ROOT, isDerivedRule } from "../domain/denied-rule";

/** The settings file the rules go to. MESA_SETTINGS_LOCAL overrides it (tests, another machine). */
export const DEFAULT_SETTINGS_LOCAL = "G:/WorkSpace/designli/.claude/settings.local.json";
type Env = Record<string, string | undefined>;
export const worktreesRoot = (env: Env = process.env) => env.MESA_WORKTREES_ROOT?.trim() || DEFAULT_WORKTREES_ROOT;

/** A TransitionError so the route answers 409 with the Spanish reason and the card stays pending. */
export class SettingsRuleError extends TransitionError {}

/** The sandbox board (MESA_ENV=sandbox, docs/SANDBOX.md) never writes the live settings file unless a path is given. */
export function settingsLocalPath(env: Env = process.env): string {
  const own = env.MESA_SETTINGS_LOCAL?.trim();
  if (own) return own;
  if (String(env.MESA_ENV ?? "").trim().toLowerCase() === "sandbox") throw new SettingsRuleError("en el sandbox no se escribe el settings.local.json real");
  return DEFAULT_SETTINGS_LOCAL;
}

/** Adds `rule` to permissions.allow. Returns whether the file changed (false: the rule was already there). */
export function addAllowRule(file: string, rule: string, root: string = DEFAULT_WORKTREES_ROOT): boolean {
  if (!isDerivedRule(rule, root)) throw new SettingsRuleError("esa regla no es una de las que Mesa deriva de una edición bloqueada");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new SettingsRuleError(`no se pudo leer ${file}: ${(e as Error).message}`);
  }
  let json: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      json = parsed as Record<string, unknown>;
    } catch {
      throw new SettingsRuleError(`${file} no es JSON válido; no se tocó`);
    }
  }
  const perms = json.permissions === undefined ? {} : json.permissions;
  if (!perms || typeof perms !== "object" || Array.isArray(perms)) throw new SettingsRuleError("permissions no es un objeto; no se tocó el archivo");
  const p = perms as Record<string, unknown>;
  const allow = p.allow === undefined ? [] : p.allow;
  if (!Array.isArray(allow)) throw new SettingsRuleError("permissions.allow no es una lista; no se tocó el archivo");
  if (allow.includes(rule)) return false;
  p.allow = [...allow, rule];
  json.permissions = p;
  const indent = /^\{\r?\n(\s+)"/.exec(text)?.[1] ?? "  ";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const out = `${JSON.stringify(json, null, indent).replace(/\n/g, eol)}${eol}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, out, "utf8");
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new SettingsRuleError(`no se pudo escribir ${file}: ${(e as Error).message}`);
  }
  return true;
}
