// Cloudflare Access JWT verification (the first key of the phone gate, see src/lib/access.ts).
//
// Mesa is reached from the phone through a Cloudflare Tunnel behind a Cloudflare Access app. Access logs the user in
// at the edge and adds a signed JWT to every request it lets through (header Cf-Access-Jwt-Assertion; the same token
// is in the CF_Authorization cookie). The tunnel is a reverse proxy ON this PC, so Mesa cannot tell from the socket
// who is calling: it verifies the JWT itself, with WebCrypto, against the team's published keys
// (https://<team>.cloudflareaccess.com/cdn-cgi/access/certs). No dependency, runs on the proxy's Node runtime.
//
// Fail closed: missing config, unreachable keys, unknown key, any failing claim = refused.

export interface CfAccessConfig {
  /** Team domain, e.g. "myteam.cloudflareaccess.com" (no scheme). */
  team: string;
  /** The Access application's AUD tag. */
  aud: string;
  /** The one email allowed in (compared case-insensitively). */
  email: string;
}

/** Why a token was refused. Kept out of HTTP responses; tests and logs use it. */
export type CfRefusal =
  | "missing"
  | "malformed"
  | "alg"
  | "certs_unreachable"
  | "unknown_kid"
  | "signature"
  | "iss"
  | "aud"
  | "exp"
  | "nbf"
  | "email";

export type CfVerdict = { ok: true; email: string } | { ok: false; reason: CfRefusal };

const TEAM_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** MESA_CF_ACCESS_TEAM accepts "team.cloudflareaccess.com" or "https://team.cloudflareaccess.com/". null if unusable. */
export function normalizeTeam(raw: string | undefined | null): string | null {
  const s = raw?.trim().replace(/^https:\/\//i, "").replace(/\/+$/, "");
  return s && TEAM_RE.test(s) ? s.toLowerCase() : null;
}

/** All three variables, or null: with anything missing no forwarded request gets in. */
export function cfAccessConfig(env: Record<string, string | undefined>): CfAccessConfig | null {
  const team = normalizeTeam(env.MESA_CF_ACCESS_TEAM);
  const aud = env.MESA_CF_ACCESS_AUD?.trim();
  const email = env.MESA_CF_ACCESS_EMAIL?.trim();
  return team && aud && email ? { team, aud, email } : null;
}

// ---------------------------------------------------------------------------------------------- keys (JWKS)

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
}

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

export interface KeyStoreOptions {
  /** Fetch and parse the JSON at `url`. Throws on any failure. Default: fetch with a 5 s limit and no redirects. */
  fetchJson?: (url: string) => Promise<unknown>;
  now?: () => number;
  /** How long a fetched key set is trusted (default 10 min). */
  ttlMs?: number;
  /** Minimum age of the cached set before an unknown kid may trigger a refetch (default 30 s). */
  refetchGapMs?: number;
  /** After a failed fetch, fail fast for this long (default 5 s) instead of hammering the endpoint. */
  failGapMs?: number;
}

export class CertsUnreachable extends Error {}

const defaultFetchJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`certs ${res.status}`);
  return res.json();
};

/** Keys of one team, cached with a TTL and refetched (once, rate limited) when a token names a kid we do not know. */
export function createKeyStore(opts: KeyStoreOptions = {}) {
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? 10 * 60_000;
  const refetchGapMs = opts.refetchGapMs ?? 30_000;
  const failGapMs = opts.failGapMs ?? 5_000;
  const sets = new Map<string, { at: number; keys: Map<string, CryptoKey> }>();
  const inflight = new Map<string, Promise<{ at: number; keys: Map<string, CryptoKey> }>>();
  const failedAt = new Map<string, number>();

  async function load(team: string) {
    const last = failedAt.get(team);
    if (last !== undefined && now() - last < failGapMs) throw new CertsUnreachable("recent failure");
    let pending = inflight.get(team);
    if (!pending) {
      pending = (async () => {
        try {
          const body = (await fetchJson(`https://${team}/cdn-cgi/access/certs`)) as { keys?: Jwk[] };
          const keys = new Map<string, CryptoKey>();
          for (const k of body?.keys ?? []) {
            if (k.kty !== "RSA" || !k.kid || !k.n || !k.e) continue;
            keys.set(k.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true }, RS256, false, ["verify"]));
          }
          if (keys.size === 0) throw new Error("no usable keys");
          const set = { at: now(), keys };
          sets.set(team, set);
          failedAt.delete(team);
          return set;
        } catch {
          failedAt.set(team, now());
          throw new CertsUnreachable("fetch failed");
        } finally {
          inflight.delete(team);
        }
      })();
      inflight.set(team, pending);
    }
    return pending;
  }

  return {
    /** The key for `kid`, or null when the team does not publish it. Throws CertsUnreachable. */
    async getKey(team: string, kid: string): Promise<CryptoKey | null> {
      let set = sets.get(team);
      let fresh = false;
      if (!set || now() - set.at >= ttlMs) {
        set = await load(team);
        fresh = true;
      }
      const hit = set.keys.get(kid);
      if (hit) return hit;
      if (fresh || now() - set.at < refetchGapMs) return null; // just fetched, or refetched too recently
      return (await load(team)).keys.get(kid) ?? null;
    },
    /** Test helper: forget everything. */
    clear() {
      sets.clear();
      failedAt.clear();
    },
  };
}

export type KeyStore = ReturnType<typeof createKeyStore>;

const defaultStore = createKeyStore();

// ------------------------------------------------------------------------------------------------- verification

const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(s, "base64url"));
const parseJson = (s: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const LEEWAY_S = 30;

/**
 * Verify an Access JWT: RS256 signature against the team's keys, iss = https://<team>, aud contains the app's AUD,
 * exp not passed, nbf reached, email equals the configured one (case-insensitive).
 */
export async function verifyAccessJwt(token: string | null | undefined, cfg: CfAccessConfig, store: KeyStore = defaultStore, nowMs: number = Date.now()): Promise<CfVerdict> {
  if (!token) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return { ok: false, reason: "malformed" };
  const [h, p, s] = parts as [string, string, string];
  const header = parseJson(h);
  const claims = parseJson(p);
  if (!header || !claims) return { ok: false, reason: "malformed" };
  if (header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "alg" };

  let key: CryptoKey | null;
  try {
    key = await store.getKey(cfg.team, header.kid);
  } catch {
    return { ok: false, reason: "certs_unreachable" };
  }
  if (!key) return { ok: false, reason: "unknown_kid" };

  let valid = false;
  try {
    valid = await crypto.subtle.verify(RS256.name, key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "signature" };

  const nowS = Math.floor(nowMs / 1000);
  if (claims.iss !== `https://${cfg.team}`) return { ok: false, reason: "iss" };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.aud)) return { ok: false, reason: "aud" };
  if (typeof claims.exp !== "number" || claims.exp <= nowS) return { ok: false, reason: "exp" };
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > nowS + LEEWAY_S)) return { ok: false, reason: "nbf" };
  const email = typeof claims.email === "string" ? claims.email : "";
  if (!email || email.toLowerCase() !== cfg.email.toLowerCase()) return { ok: false, reason: "email" };
  return { ok: true, email };
}
