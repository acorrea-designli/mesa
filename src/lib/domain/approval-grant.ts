// The one-shot grant a "Permitir esta vez" press creates (t143 PR5), pure.
//
// Auto mode denied a call, the PermissionDenied hook filed a card, and Andrés allowed it once. The server then stores a
// grant: the exact tool, a hash of that call's identity, the caller (agent and session) and a short expiry. The
// PreToolUse hook later asks Mesa to consume a grant for the retried call; a match lets that one call through.
//
// The hash is always derived here, on the server, from the input the card stored. A client never sends one.
//
//   Bash / PowerShell : tool + the exact `command` + `dangerouslyDisableSandbox` (absent = false).
//                       `description`, `timeout` and `run_in_background` are left out on purpose: the model words
//                       `description` differently on the retry (measured), and neither of the others changes what
//                       the command does.
//   everything else   : tool + the whole tool_input, canonical JSON (keys sorted, recursively). An MCP call, a file
//                       edit, a Write: any difference in any field is a different call.
import { createHash } from "node:crypto";
import { canonicalJson } from "./approval-once";

export { canonicalJson };

/** A grant lives this long after the decision; the retry follows the decision within seconds. */
export const GRANT_TTL_MS = 5 * 60_000;

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

/** What identifies a call: the part of the input that, when it differs, makes it another call. */
export function identityOf(tool: string, toolInput: unknown): unknown {
  const ti = toolInput && typeof toolInput === "object" && !Array.isArray(toolInput) ? (toolInput as Record<string, unknown>) : {};
  if (SHELL_TOOLS.has(tool)) return { command: typeof ti.command === "string" ? ti.command : "", dangerouslyDisableSandbox: ti.dangerouslyDisableSandbox === true };
  return ti;
}

export function grantHash(tool: string, toolInput: unknown): string {
  return createHash("sha256").update(`${tool}\n${canonicalJson(identityOf(tool, toolInput))}`).digest("hex");
}

/** A call a grant can cover: a shell call needs a command, anything else needs a non-empty input. */
export function grantable(tool: string, toolInput: unknown): { ok: true } | { ok: false; why: string } {
  if (!tool.trim()) return { ok: false, why: "La llamada no trae el nombre de la herramienta." };
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput) || !Object.keys(toolInput).length) return { ok: false, why: "La llamada no trae su entrada." };
  if (SHELL_TOOLS.has(tool) && !String((toolInput as Record<string, unknown>).command ?? "").trim()) return { ok: false, why: "La llamada no trae el comando." };
  return { ok: true };
}
