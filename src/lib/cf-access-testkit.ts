// Test helper: a throwaway RSA key pair standing in for Cloudflare's, and Access-shaped JWTs signed with it.
import { createKeyStore, type CfAccessConfig } from "./cf-access";

export const CFG: CfAccessConfig = { team: "acme.cloudflareaccess.com", aud: "aud-tag-1234", email: "andres@example.com" };
export const NOW_S = 1_800_000_000;
export const NOW_MS = NOW_S * 1000;

const b64u = (b: Uint8Array | string) => Buffer.from(b).toString("base64url");
const ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) } as const;

export interface TestKey {
  kid: string;
  privateKey: CryptoKey;
  jwk: JsonWebKey & { kid: string };
}

export async function makeKey(kid: string): Promise<TestKey> {
  const pair = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid } };
}

/** An Access-shaped token. `claims` overrides the defaults; set a claim to undefined to drop it. */
export async function signJwt(key: TestKey, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): Promise<string> {
  const payload: Record<string, unknown> = {
    iss: `https://${CFG.team}`,
    aud: [CFG.aud],
    email: CFG.email,
    iat: NOW_S - 60,
    nbf: NOW_S - 60,
    exp: NOW_S + 3600,
    type: "app",
    ...claims,
  };
  const h = b64u(JSON.stringify({ alg: "RS256", kid: key.kid, typ: "JWT", ...header }));
  const p = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}

/** A key store that "fetches" the given keys instead of calling Cloudflare; `calls` counts the fetches. */
export function storeFor(keys: () => TestKey[], opts: { now?: () => number; refetchGapMs?: number; failGapMs?: number } = {}) {
  const calls = { n: 0 };
  const store = createKeyStore({
    now: opts.now ?? (() => NOW_MS),
    refetchGapMs: opts.refetchGapMs ?? 0,
    failGapMs: opts.failGapMs ?? 0,
    fetchJson: async (url) => {
      calls.n++;
      if (url !== `https://${CFG.team}/cdn-cgi/access/certs`) throw new Error(`unexpected certs url ${url}`);
      return { keys: keys().map((k) => k.jwk), public_cert: {}, public_certs: [] };
    },
  });
  return { store, calls };
}
