import type { GhResult, GhRunner } from "../gh";

export type Handler = (args: string[], input?: string) => GhResult | undefined;

/** A gh runner that answers from handlers in order and records every call. */
export function fakeGh(...handlers: Handler[]) {
  const calls: { args: string[]; input?: string }[] = [];
  const run: GhRunner = async (args, opts) => {
    calls.push({ args, input: opts?.input });
    for (const h of handlers) {
      const r = h(args, opts?.input);
      if (r) return r;
    }
    return { code: 1, stdout: "", stderr: `fake gh: no handler for ${args.join(" ")}` };
  };
  return { run, calls, handlers };
}

export const ok = (body: unknown): GhResult => ({ code: 0, stdout: typeof body === "string" ? body : JSON.stringify(body), stderr: "" });

/** A `gh api -i` style response. */
export const http = (status: number, headers: Record<string, string>, body: unknown = ""): GhResult => ({
  code: status >= 300 ? 1 : 0,
  stdout: `HTTP/2.0 ${status} X\r\n${Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n")}\r\n\r\n${typeof body === "string" ? body : JSON.stringify(body)}`,
  stderr: status >= 400 ? `gh: HTTP ${status}` : "",
});

export const path = (args: string[]) => (args[0] === "api" ? args.find((a, i) => i > 0 && !a.startsWith("-") && args[i - 1] !== "-H") : undefined);
export const header = (args: string[], name: string) => {
  const i = args.findIndex((a, j) => args[j - 1] === "-H" && a.toLowerCase().startsWith(name.toLowerCase() + ":"));
  return i >= 0 ? args[i]!.slice(name.length + 1).trim() : undefined;
};
