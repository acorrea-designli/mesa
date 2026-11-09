// Phone status bar rules (telefono.md Devs note): "vía túnel" when Mesa is served through the tunnel and the PC
// answers, "sin túnel" when it does not, "Vuelve a entrar" when the Cloudflare Access session has expired (the ping
// is redirected to the Access login, or Mesa refuses the Access token). Pure so it is unit tested; TunnelStatus.tsx
// does the polling.

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;

export type LinkState = "local" | "tunnel" | "down" | "login";
/** What one health ping told us. */
export type Ping = "ok" | "down" | "login";

/** The page is open on this PC itself (no tunnel involved). */
export const isLoopbackHost = (hostname: string) => LOOPBACK.test(hostname);

/**
 * One `fetch("/api/health", { redirect: "manual" })` -> Ping. `res` is null when the fetch itself failed (offline, DNS).
 *  - an opaque redirect (type "opaqueredirect", status 0) is Cloudflare Access sending us to its login: "login";
 *  - 403 is Access or Mesa refusing the Access token: "login";
 *  - 5xx (cloudflared answers 502 when Mesa is down, 530 when the tunnel is) or no answer: "down";
 *  - anything else below 500 proves the tunnel and the PC are up (a 401 just means "not paired yet"): "ok".
 */
export function classifyPing(res: { status: number; type?: string } | null): Ping {
  if (!res) return "down";
  if (res.type === "opaqueredirect" || res.status === 0) return "login";
  if (res.status === 403) return "login";
  return res.status < 500 ? "ok" : "down";
}

export function linkState(hostname: string, ping: Ping): LinkState {
  if (!hostname || isLoopbackHost(hostname)) return "local";
  return ping === "ok" ? "tunnel" : ping;
}

export const LINK_LABEL: Record<Exclude<LinkState, "local">, string> = {
  tunnel: "vía túnel",
  down: "sin túnel",
  login: "Vuelve a entrar",
};
