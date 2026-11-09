// Access policy for every request (used by src/proxy.ts, pure so it is unit tested).
//
// Mesa listens on 127.0.0.1 and is reached from the phone through `tailscale serve`, which is a reverse proxy ON
// this PC: from the board's point of view that traffic arrives from loopback, and the Host header can even be
// rewritten to look like loopback. So the Host alone proves nothing. A request is LOCAL only when its Host is
// loopback AND it carries no sign of a proxy. Everything else needs the MESA_TOKEN cookie/header
// (and, when MESA_TAILSCALE_USER is set, the matching Tailscale identity header).
//
// Gotcha (measured on Next 16.4.5, base-server.js): Next ITSELF sets X-Forwarded-Host/-Port/-Proto/-For on every
// request before the proxy runs (`??=`, from the Host header, its port, the scheme and the socket address). Treating
// the mere presence of those four as "forwarded" would refuse every local request. So they count only when their
// value is not what Next would have filled in for a direct loopback connection.

export const COOKIE = "mesa_token";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
/** Loopback addresses as Node reports a socket's remoteAddress. */
const LOOPBACK_ADDR = /^(::1|(::ffff:)?127\.\d+\.\d+\.\d+)$/i;

/** Headers only a proxy adds (Next never sets them). Any one of them, with any value, makes the request "forwarded". */
export const FORWARDING_HEADERS = [
  "tailscale-user-login",
  "tailscale-user-name",
  "tailscale-user-profile-pic",
  "tailscale-headers-info",
  "forwarded",
  "x-real-ip",
  "x-forwarded-server",
  "x-original-forwarded-for",
  "via",
  "cf-connecting-ip",
  "cf-ray",
  "true-client-ip",
] as const;

/** Served to a forwarded request without the token: they hold no board data (manifest, icons, shell, offline page). */
const PUBLIC_PATHS = new Set([
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
]);

/** The pairing link: gated by its own one-time code, so it is the one page a phone without the cookie may open. */
const PAIR_PATH = "/pair";

/** Paths that only answer to a request that is local to this PC, even with a valid token. */
const LOCAL_ONLY_PREFIXES = ["/api/pairing"];

export interface HeaderReader {
  get(name: string): string | null;
}

export interface AccessInput {
  headers: HeaderReader;
  path: string;
  /** The mesa_token cookie value, if any. */
  cookie?: string | undefined;
}

export interface AccessEnv {
  token?: string | undefined;
  /** MESA_TAILSCALE_USER: the one Tailscale login allowed through the tunnel. */
  tailscaleUser?: string | undefined;
}

export type AccessDecision = { allow: true; reason: "local" | "public" | "pair" | "token" } | { allow: false; status: 401 | 403; message: string };

const has = (headers: HeaderReader, name: string) => {
  const v = headers.get(name);
  return v !== null && v !== "";
};

/**
 * The request came through a proxy (Tailscale Serve, Cloudflare, nginx...). Besides the proxy-only headers, the
 * X-Forwarded-* set is compared with what Next fills in for a direct connection: Host as host, a loopback address
 * as the client, "http" as the scheme, the Host's own port. Anything else was set by someone upstream.
 */
export function isForwarded(headers: HeaderReader): boolean {
  if (FORWARDING_HEADERS.some((h) => has(headers, h))) return true;
  const host = (headers.get("host") ?? "").toLowerCase();
  const xfh = headers.get("x-forwarded-host");
  if (xfh && xfh.toLowerCase() !== host) return true;
  const xfp = headers.get("x-forwarded-proto");
  if (xfp && xfp.toLowerCase() !== "http") return true;
  const xfport = headers.get("x-forwarded-port");
  const hostPort = /:(\d+)$/.exec(host)?.[1];
  if (xfport && hostPort && xfport !== hostPort) return true;
  const xff = headers.get("x-forwarded-for");
  if (xff && !LOOPBACK_ADDR.test(xff.trim())) return true; // a chain ("a, b") fails the test too
  return false;
}

/** True only for a request that really came from a browser on this PC. */
export function isLocalRequest(headers: HeaderReader): boolean {
  return LOCAL_HOST.test(headers.get("host") ?? "") && !isForwarded(headers);
}

/** Constant-time string comparison (no early exit on the first different byte). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function decideAccess(input: AccessInput, env: AccessEnv): AccessDecision {
  const { headers, path } = input;
  if (isLocalRequest(headers)) return { allow: true, reason: "local" };

  // From here the request is remote (or came through a proxy), whatever its Host says.
  if (!env.token) {
    return { allow: false, status: 403, message: "Mesa only answers on this PC. Set MESA_TOKEN to allow remote access." };
  }
  if (env.tailscaleUser) {
    const login = headers.get("tailscale-user-login");
    if (!login || login.toLowerCase() !== env.tailscaleUser.toLowerCase()) {
      return { allow: false, status: 403, message: "Forbidden: this Tailscale user is not allowed." };
    }
  }
  if (LOCAL_ONLY_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return { allow: false, status: 403, message: "Forbidden: only from the PC Mesa runs on." };
  }
  if (PUBLIC_PATHS.has(path)) return { allow: true, reason: "public" };
  if (path === PAIR_PATH) return { allow: true, reason: "pair" };

  const given = headers.get("x-mesa-token") ?? input.cookie ?? "";
  if (!safeEqual(given, env.token)) {
    return { allow: false, status: 401, message: "Unauthorized. On your PC open Mesa, Teléfono, and scan the QR to link this phone." };
  }
  return { allow: true, reason: "token" };
}
