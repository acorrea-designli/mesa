import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { decideAccess, isForwarded, isLocalRequest, safeEqual, type AccessEnv } from "./access";
import { verifyAccessJwt } from "./cf-access";
import { CFG, NOW_MS, makeKey, signJwt, storeFor, type TestKey } from "./cf-access-testkit";

const TOKEN = "t0ken-for-tests-1234567890";
const hdrs = (o: Record<string, string>) => new Headers(o);

let key: TestKey;
let jwt: string;
beforeAll(async () => {
  key = await makeKey("kid-1");
  jwt = await signJwt(key);
});

/** decideAccess with the JWT checked against our own key store at a fixed clock. */
const decide = (h: Record<string, string>, env: AccessEnv, path = "/", cookie?: string, accessCookie?: string) => {
  const { store } = storeFor(() => [key]);
  return decideAccess({ headers: hdrs(h), path, cookie, accessCookie }, env, (t, cfg) => verifyAccessJwt(t, cfg, store, NOW_MS));
};

describe("local detection", () => {
  it("plain loopback Host is local", () => {
    for (const host of ["localhost:8790", "127.0.0.1:8790", "[::1]:8790", "LOCALHOST"]) expect(isLocalRequest(hdrs({ host }))).toBe(true);
  });
  it("a loopback Host with any forwarding header is not local", () => {
    for (const h of ["Cf-Access-Jwt-Assertion", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-Port", "Forwarded", "X-Real-IP", "Cf-Visitor", "Via", "CF-Connecting-IP", "CF-Ray"]) {
      const headers = hdrs({ host: "127.0.0.1:8790", [h]: "x" });
      expect(isForwarded(headers), h).toBe(true);
      expect(isLocalRequest(headers), h).toBe(false);
    }
  });
  it("the X-Forwarded-* Next 16 fills in itself on a direct local request do not make it forwarded", () => {
    // Measured: base-server.js sets all four on every request, before src/proxy.ts runs.
    for (const xff of ["::1", "127.0.0.1", "::ffff:127.0.0.1"]) {
      const h = hdrs({ host: "127.0.0.1:8790", "x-forwarded-host": "127.0.0.1:8790", "x-forwarded-port": "8790", "x-forwarded-proto": "http", "x-forwarded-for": xff });
      expect(isForwarded(h), xff).toBe(false);
      expect(isLocalRequest(h), xff).toBe(true);
    }
  });
  it("those same headers with a value Next would not have set are forwarded", () => {
    const own = { host: "localhost:8790", "x-forwarded-host": "localhost:8790", "x-forwarded-port": "8790", "x-forwarded-proto": "http", "x-forwarded-for": "::1" };
    expect(isForwarded(hdrs(own))).toBe(false);
    expect(isForwarded(hdrs({ ...own, "x-forwarded-for": "203.0.113.7" }))).toBe(true); // a remote client
    expect(isForwarded(hdrs({ ...own, "x-forwarded-for": "203.0.113.7, 127.0.0.1" }))).toBe(true); // a chain
    expect(isForwarded(hdrs({ ...own, "x-forwarded-host": "mesa.example.com" }))).toBe(true);
    expect(isForwarded(hdrs({ ...own, "x-forwarded-proto": "https" }))).toBe(true);
    expect(isForwarded(hdrs({ ...own, "x-forwarded-port": "443" }))).toBe(true);
  });
  it("a non-loopback Host is not local", () => {
    expect(isLocalRequest(hdrs({ host: "mesa.example.com" }))).toBe(false);
    expect(isLocalRequest(hdrs({ host: "192.168.1.20:8790" }))).toBe(false);
    expect(isLocalRequest(hdrs({}))).toBe(false);
  });
});

describe("decideAccess", () => {
  const env: AccessEnv = { token: TOKEN, cf: CFG };
  // What cloudflared delivers: the public Host, Cloudflare's headers and the Access JWT.
  const viaTunnel = { host: "mesa.example.com", "cf-ray": "abc", "cf-access-jwt-assertion": "" };
  const withJwt = (t = jwt) => ({ ...viaTunnel, "cf-access-jwt-assertion": t });

  it("plain localhost passes without a token or Access", async () => {
    expect(await decide({ host: "localhost:8790" }, env)).toEqual({ allow: true, reason: "local" });
    expect(await decide({ host: "localhost:8790" }, {})).toEqual({ allow: true, reason: "local" });
  });

  it("a valid Access JWT without the Mesa token is refused (401)", async () => {
    expect(await decide(withJwt(), env)).toMatchObject({ allow: false, status: 401, why: "unpaired" });
  });

  it("a wrong token or cookie is refused (401)", async () => {
    expect(await decide({ ...withJwt(), "x-mesa-token": "nope" }, env)).toMatchObject({ allow: false, status: 401 });
    expect(await decide(withJwt(), env, "/", "nope")).toMatchObject({ allow: false, status: 401 });
  });

  it("a valid Access JWT plus the right token (cookie or header) passes", async () => {
    expect(await decide(withJwt(), env, "/", TOKEN)).toEqual({ allow: true, reason: "token" });
    expect(await decide({ ...withJwt(), "x-mesa-token": TOKEN }, env)).toEqual({ allow: true, reason: "token" });
  });

  it("the CF_Authorization cookie works when the header is missing", async () => {
    expect(await decide({ host: "mesa.example.com", "cf-ray": "abc" }, env, "/", TOKEN, jwt)).toEqual({ allow: true, reason: "token" });
  });

  it("the Mesa token alone is not enough: no JWT is 403, wherever it is checked", async () => {
    expect(await decide({ host: "mesa.example.com", "cf-ray": "abc" }, env, "/", TOKEN)).toMatchObject({ allow: false, status: 403, why: "missing" });
    expect(await decide({ host: "mesa.example.com", "x-mesa-token": TOKEN }, env, "/manifest.webmanifest")).toMatchObject({ allow: false, status: 403 });
    expect(await decide({ host: "mesa.example.com" }, env, "/pair")).toMatchObject({ allow: false, status: 403 });
  });

  it("a wrong aud, another email, an expired or forged JWT is 403 even with the token", async () => {
    const bad = {
      aud: await signJwt(key, { aud: ["other-app"] }),
      email: await signJwt(key, { email: "mallory@example.com" }),
      expired: await signJwt(key, { exp: NOW_MS / 1000 - 5 }),
      forged: await signJwt(await makeKey("kid-1")),
    };
    for (const [name, t] of Object.entries(bad)) expect(await decide(withJwt(t), env, "/", TOKEN), name).toMatchObject({ allow: false, status: 403 });
  });

  it("an unknown kid is 403", async () => {
    expect(await decide(withJwt(await signJwt(await makeKey("kid-other"))), env, "/", TOKEN)).toMatchObject({ allow: false, status: 403, why: "unknown_kid" });
  });

  it("unreachable Access keys fail closed (403)", async () => {
    const d = await decideAccess({ headers: hdrs(withJwt()), path: "/", cookie: TOKEN }, env, async () => ({ ok: false, reason: "certs_unreachable" }));
    expect(d).toMatchObject({ allow: false, status: 403, why: "certs_unreachable" });
  });

  it("without MESA_TOKEN or without the Access config every forwarded request is refused (403), public paths included", async () => {
    expect(await decide(withJwt(), {})).toMatchObject({ allow: false, status: 403, why: "no_token" });
    expect(await decide(withJwt(), { token: TOKEN })).toMatchObject({ allow: false, status: 403, why: "no_access_config" });
    expect(await decide(withJwt(), { token: TOKEN, cf: null }, "/manifest.webmanifest")).toMatchObject({ allow: false, status: 403 });
    expect(await decide({ host: "mesa.example.com" }, {}, "/pair")).toMatchObject({ allow: false, status: 403 });
  });

  it("manifest, icons, sw.js and the offline page need no Mesa token (still the Access JWT); everything else does", async () => {
    for (const p of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"]) {
      expect(await decide(withJwt(), env, p), p).toEqual({ allow: true, reason: "public" });
    }
    for (const p of ["/", "/tickets", "/api/items", "/api/stream", "/telefono", "/sw.js.map", "/offline"]) {
      expect(await decide(withJwt(), env, p), p).toMatchObject({ allow: false, status: 401 });
    }
  });

  it("/pair opens without the Mesa cookie (its one-time code is the key) but still needs the Access JWT", async () => {
    expect(await decide(withJwt(), env, "/pair")).toEqual({ allow: true, reason: "pair" });
    expect(await decide(viaTunnel, env, "/pair")).toMatchObject({ allow: false, status: 403 });
  });

  it("the pairing API only answers to the PC itself, even with the JWT and the token", async () => {
    expect(await decide(withJwt(), env, "/api/pairing", TOKEN)).toMatchObject({ allow: false, status: 403 });
    expect(await decide(withJwt(), env, "/api/pairing/x", TOKEN)).toMatchObject({ allow: false, status: 403 });
    expect(await decide({ host: "localhost:8790" }, env, "/api/pairing")).toEqual({ allow: true, reason: "local" });
  });

  it("?token= is not a credential", async () => {
    // The guard never reads the query: a URL with the token and no cookie/header is refused.
    expect(await decide(withJwt(), env, "/")).toMatchObject({ allow: false, status: 401 });
  });
});

describe("safeEqual", () => {
  it("compares the whole string", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("src/proxy.ts", () => {
  const VARS = ["MESA_TOKEN", "MESA_CF_ACCESS_TEAM", "MESA_CF_ACCESS_AUD", "MESA_CF_ACCESS_EMAIL"] as const;
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });
  const req = (path: string, h: Record<string, string>) => new NextRequest(`http://127.0.0.1:8790${path}`, { headers: h });
  const configure = () => {
    process.env.MESA_TOKEN = TOKEN;
    process.env.MESA_CF_ACCESS_TEAM = CFG.team;
    process.env.MESA_CF_ACCESS_AUD = CFG.aud;
    process.env.MESA_CF_ACCESS_EMAIL = CFG.email;
    // Cloudflare's certs endpoint, answered with our key.
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { "content-type": "application/json" } }));
  };
  const nowJwt = (claims: Record<string, unknown> = {}) => {
    const s = Math.floor(Date.now() / 1000);
    return signJwt(key, { iat: s - 60, nbf: s - 60, exp: s + 3600, ...claims });
  };

  it("answers the cases of the access rule", async () => {
    configure();
    const tunnel = { host: "mesa.example.com", "cf-ray": "abc" };
    const good = await nowJwt();
    expect((await proxy(req("/", { host: "localhost:8790" }))).status).toBe(200); // plain localhost: pass
    expect((await proxy(req("/", tunnel))).status).toBe(403); // no Access JWT
    expect((await proxy(req("/", { ...tunnel, "cf-access-jwt-assertion": good }))).status).toBe(401); // JWT, no Mesa token
    expect((await proxy(req("/", { ...tunnel, "cf-access-jwt-assertion": good, cookie: `mesa_token=${TOKEN}` }))).status).toBe(200); // both keys
    expect((await proxy(req("/", { ...tunnel, cookie: `mesa_token=${TOKEN}; CF_Authorization=${good}` }))).status).toBe(200); // JWT in the cookie
    const wrong = await nowJwt({ email: "mallory@example.com" });
    expect((await proxy(req("/", { ...tunnel, "cf-access-jwt-assertion": wrong, cookie: `mesa_token=${TOKEN}` }))).status).toBe(403); // wrong email
  });

  it("a page load without the Mesa token gets the Spanish code form; an API call gets plain 401", async () => {
    configure();
    const base = { host: "mesa.example.com", "cf-access-jwt-assertion": await nowJwt() };
    const page = await proxy(req("/", { ...base, "sec-fetch-mode": "navigate", accept: "text/html" }));
    expect(page.status).toBe(401);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain('action="/pair"');
    expect(html).toContain('name="code"');
    expect(html).toContain("Vincula este teléfono");
    const api = await proxy(req("/api/items", { ...base, "sec-fetch-mode": "cors", accept: "application/json" }));
    expect(api.status).toBe(401);
    expect(api.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("refuses forwarded requests when MESA_TOKEN or the Access config is not set", async () => {
    for (const k of VARS) delete process.env[k];
    expect((await proxy(req("/", { host: "127.0.0.1:8790", "x-forwarded-for": "203.0.113.7" }))).status).toBe(403);
    expect((await proxy(req("/", { host: "localhost:8790" }))).status).toBe(200);
    process.env.MESA_TOKEN = TOKEN;
    expect((await proxy(req("/", { host: "mesa.example.com", cookie: `mesa_token=${TOKEN}` }))).status).toBe(403);
  });
});
