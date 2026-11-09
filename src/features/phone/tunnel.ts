// Phone status bar rules (telefono.md Devs note): "vía túnel" when Mesa is served through the tunnel and the PC
// answers, "sin túnel" when it does not. Pure so it is unit tested; TunnelStatus.tsx does the polling.

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;

export type LinkState = "local" | "tunnel" | "down";

/** The page is open on this PC itself (no tunnel involved). */
export const isLoopbackHost = (hostname: string) => LOOPBACK.test(hostname);

/** A health ping counts as "the PC answered" for anything below 500: a 401 still proves the tunnel and the PC are up
 *  (tailscale serve answers 502/503/504 when Mesa is down; a network error means the PC is unreachable). */
export const pingReachable = (status: number | null) => status !== null && status < 500;

export function linkState(hostname: string, reachable: boolean): LinkState {
  if (!hostname || isLoopbackHost(hostname)) return "local";
  return reachable ? "tunnel" : "down";
}

export const LINK_LABEL: Record<Exclude<LinkState, "local">, string> = {
  tunnel: "vía túnel",
  down: "sin túnel",
};
