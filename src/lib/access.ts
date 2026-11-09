// Access policy for every request (used by src/proxy.ts, pure apart from the JWT check so it is unit tested).
//
// Mesa listens on 127.0.0.1 and is reached from the phone through a Cloudflare Tunnel (cloudflared), a reverse proxy
// ON this PC: from the board's point of view that traffic arrives from loopback, and the Host header can even be
// rewritten to look like loopback. So the Host alone proves nothing. A request is LOCAL only when its Host is
// loopback AND it carries no sign of a proxy. Everything else needs two keys:
//   1. a valid Cloudflare Access JWT (Cf-Access-Jwt-Assertion, or the CF_Authorization cookie): signature, aud,
//      issuer, expiry and Andrés's email, all checked here (src/lib/cf-access.ts). Fails closed: missing config,
//      unreachable keys or any failing check is a 403;
//   2. the MESA_TOKEN cookie/header (the cookie is set by pairing, /pair), except on the public shell and /pair.
//
// Gotcha (measured on Next 16.4.5, base-server.js): Next ITSELF sets X-Forwarded-Host/-Port/-Proto/-For on every
// request before the proxy runs (`??=`, from the Host header, its port, the scheme and the socket address). Treating
// the mere presence of those four as "forwarded" would refuse every local request. So they count only when their
// value is not what Next would have filled in for a direct loopback connection.

import { verifyAccessJwt, type CfAccessConfig, type CfRefusal, type CfVerdict } from "./cf-access";

export const COOKIE = "mesa_token";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
/** Loopback addresses as Node reports a socket's remoteAddress. */
const LOOPBACK_ADDR = /^(::1|(::ffff:)?127\.\d+\.\d+\.\d+)$/i;

/** Headers only a proxy (Cloudflare, nginx...) adds (Next never sets them). Any one of them, with any value, makes the request "forwarded". */
export const FORWARDING_HEADERS = [
  "cf-access-jwt-assertion",
  "cf-visitor",
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

/** The pairing link and the code form: gated by their own one-time code, so the one path a phone without the cookie may open. */
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
  /** The CF_Authorization cookie value: the fallback when the Cf-Access-Jwt-Assertion header is absent. */
  accessCookie?: string | undefined;
}

export interface AccessEnv {
  token?: string | undefined;
  /** MESA_CF_ACCESS_TEAM / _AUD / _EMAIL (cfAccessConfig). null or undefined: Access is not configured, nothing remote gets in. */
  cf?: CfAccessConfig | null | undefined;
}

export type AccessDecision =
  | { allow: true; reason: "local" | "public" | "pair" | "token" }
  | { allow: false; status: 401 | 403; message: string; why: "no_token" | "no_access_config" | "local_only" | "unpaired" | CfRefusal };

/** The JWT check, injectable so tests can supply their own keys. */
export type VerifyJwt = (jwt: string | null, cfg: CfAccessConfig) => Promise<CfVerdict>;

const has = (headers: HeaderReader, name: string) => {
  const v = headers.get(name);
  return v !== null && v !== "";
};

/**
 * The request came through a proxy (Cloudflare Tunnel, nginx...). Besides the proxy-only headers, the
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

export async function decideAccess(input: AccessInput, env: AccessEnv, verify: VerifyJwt = (jwt, cfg) => verifyAccessJwt(jwt, cfg)): Promise<AccessDecision> {
  const { headers, path } = input;
  if (isLocalRequest(headers)) return { allow: true, reason: "local" };

  // From here the request is remote (or came through a proxy), whatever its Host says.
  if (!env.token) {
    return { allow: false, status: 403, why: "no_token", message: "Mesa only answers on this PC. Set MESA_TOKEN to allow remote access." };
  }
  if (!env.cf) {
    return {
      allow: false,
      status: 403,
      why: "no_access_config",
      message: "Mesa only answers on this PC. Set MESA_CF_ACCESS_TEAM, MESA_CF_ACCESS_AUD and MESA_CF_ACCESS_EMAIL to allow remote access.",
    };
  }
  const jwt = headers.get("cf-access-jwt-assertion") || input.accessCookie || null;
  const verdict = await verify(jwt, env.cf);
  if (!verdict.ok) {
    return { allow: false, status: 403, why: verdict.reason, message: "Forbidden: sign in through Cloudflare Access." };
  }
  if (LOCAL_ONLY_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return { allow: false, status: 403, why: "local_only", message: "Forbidden: only from the PC Mesa runs on." };
  }
  if (PUBLIC_PATHS.has(path)) return { allow: true, reason: "public" };
  if (path === PAIR_PATH) return { allow: true, reason: "pair" };

  const given = headers.get("x-mesa-token") ?? input.cookie ?? "";
  if (!safeEqual(given, env.token)) {
    return { allow: false, status: 401, why: "unpaired", message: "Unauthorized. On your PC open Mesa, Teléfono, and link this phone with the QR or the short code." };
  }
  return { allow: true, reason: "token" };
}
