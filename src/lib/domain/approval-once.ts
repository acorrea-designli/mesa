// What "Permitir esta vez" covers and what its card shows (t143 PR5), pure and free of node modules so the card can use it.
//
// A once-card is for a command or an MCP tool: Bash, PowerShell, mcp__*. Every other tool keeps today's card (a file edit
// has its derived rule; the rest can only be denied). The text the card shows for one is built HERE, on the server, from
// the stored tool_input, never taken from the client: the call Andres reads is the call the grant is hashed from, and
// `decide()` refuses a grant when the stored text is not exactly this, or is too long to be read whole.

/** One predicate for decide(), the denied hook (through the card's `once` flag) and the card. */
export const onceEligible = (tool: string): boolean => tool === "Bash" || tool === "PowerShell" || tool.startsWith("mcp__");

/** A call longer than this is not shown whole on the card, so it cannot be allowed once. */
export const MAX_SHOWN_CHARS = 20_000;

/** JSON with every object's keys sorted, so two inputs that differ only in key order read and hash alike. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** The same canonical form, indented, for an MCP call's card. */
function prettyCanonical(v: unknown, pad = ""): string {
  const next = `${pad}  `;
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => `${next}${prettyCanonical(x, next)}`).join(",\n")}\n${pad}]` : "[]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return keys.length ? `{\n${keys.map((k) => `${next}${JSON.stringify(k)}: ${prettyCanonical(o[k], next)}`).join(",\n")}\n${pad}}` : "{}";
  }
  return JSON.stringify(v) ?? "null";
}

/** The summary and the exact call a once-card shows, derived only from the stored input. */
export function shownCall(tool: string, toolInput: unknown): { summary: string; detail: string } {
  const ti = toolInput && typeof toolInput === "object" && !Array.isArray(toolInput) ? (toolInput as Record<string, unknown>) : {};
  if (tool === "Bash" || tool === "PowerShell") {
    const command = typeof ti.command === "string" ? ti.command : "";
    const unsandboxed = ti.dangerouslyDisableSandbox === true;
    const first = command.split("\n")[0] ?? "";
    return {
      summary: `${tool}: ${first.length > 80 ? `${first.slice(0, 80)}...` : first}${unsandboxed ? " (sin sandbox)" : ""}`,
      detail: `$ ${command}${unsandboxed ? "\n[sin sandbox: dangerouslyDisableSandbox]" : ""}`,
    };
  }
  return { summary: tool, detail: prettyCanonical(ti) };
}
