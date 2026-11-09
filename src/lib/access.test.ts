import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { decideAccess, isForwarded, isLocalRequest, safeEqual, type AccessEnv } from "./access";

const TOKEN = "t0ken-for-tests-1234567890";
const hdrs = (o: Record<string, string>) => new Headers(o);
const decide = (h: Record<string, string>, env: AccessEnv, path = "/", cookie?: string) => decideAccess({ headers: hdrs(h), path, cookie }, env);

describe("local detection", () => {
  it("plain loopback Host is local", () => {
    for (const host of ["localhost:8790", "127.0.0.1:8790", "[::1]:8790", "LOCALHOST"]) expect(isLocalRequest(hdrs({ host }))).toBe(true);
  });
  it("a loopback Host with any forwarding header is not local", () => {
    for (const h of ["Tailscale-User-Login", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-Port", "Forwarded", "X-Real-IP", "Tailscale-User-Name", "Via", "CF-Connecting-IP"]) {
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
    expect(isForwarded(hdrs({ ...own, "x-forwarded-for": "100.64.0.2" }))).toBe(true); // a tailnet client
    expect(isForwarded(hdrs({ ...own, "x-forwarded-for": "100.64.0.2, 127.0.0.1" }))).toBe(true); // a chain
    expect(isForwarded(hdrs({ ...own, "x-forwarded-host": "pc.tail1234.ts.net" }))).toBe(true);
    expect(isForwarded(hdrs({ ...own, "x-forwarded-proto": "https" }))).toBe(true);
    expect(isForwarded(hdrs({ ...own, "x-forwarded-port": "443" }))).toBe(true);
  });
  it("a non-loopback Host is not local", () => {
    expect(isLocalRequest(hdrs({ host: "pc.tail1234.ts.net" }))).toBe(false);
    expect(isLocalRequest(hdrs({ host: "192.168.1.20:8790" }))).toBe(false);
    expect(isLocalRequest(hdrs({}))).toBe(false);
  });
});

describe("decideAccess", () => {
  const env: AccessEnv = { token: TOKEN };
  const viaTailscale = { host: "127.0.0.1:8790", "tailscale-user-login": "andres@example.com", "x-forwarded-for": "100.64.0.2" };

  it("plain localhost passes without a token", () => {
    expect(decide({ host: "localhost:8790" }, env)).toEqual({ allow: true, reason: "local" });
    expect(decide({ host: "localhost:8790" }, {})).toEqual({ allow: true, reason: "local" });
  });

  it("loopback Host plus Tailscale headers without the token is refused (401)", () => {
    expect(decide(viaTailscale, env)).toMatchObject({ allow: false, status: 401 });
  });

  it("a wrong token or cookie is refused (401)", () => {
    expect(decide({ ...viaTailscale, "x-mesa-token": "nope" }, env)).toMatchObject({ allow: false, status: 401 });
    expect(decide(viaTailscale, env, "/", "nope")).toMatchObject({ allow: false, status: 401 });
  });

  it("the right token (cookie or header) passes", () => {
    expect(decide(viaTailscale, env, "/", TOKEN)).toEqual({ allow: true, reason: "token" });
    expect(decide({ ...viaTailscale, "x-mesa-token": TOKEN }, env)).toEqual({ allow: true, reason: "token" });
  });

  it("with MESA_TAILSCALE_USER set, a different login is refused (403) even with the token", () => {
    const e = { ...env, tailscaleUser: "andres@example.com" };
    expect(decide({ ...viaTailscale, "tailscale-user-login": "other@example.com" }, e, "/", TOKEN)).toMatchObject({ allow: false, status: 403 });
    expect(decide({ host: "pc.tail1234.ts.net", "x-forwarded-for": "1.2.3.4" }, e, "/", TOKEN)).toMatchObject({ allow: false, status: 403 });
  });

  it("the right login plus the token passes", () => {
    const e = { ...env, tailscaleUser: "Andres@Example.com" };
    expect(decide(viaTailscale, e, "/", TOKEN)).toEqual({ allow: true, reason: "token" });
  });

  it("without MESA_TOKEN every forwarded request is refused (403), public paths included", () => {
    expect(decide(viaTailscale, {})).toMatchObject({ allow: false, status: 403 });
    expect(decide(viaTailscale, {}, "/manifest.webmanifest")).toMatchObject({ allow: false, status: 403 });
    expect(decide({ host: "pc.tail1234.ts.net" }, {}, "/pair")).toMatchObject({ allow: false, status: 403 });
  });

  it("manifest, icons, sw.js and the offline page need no token; everything else does", () => {
    for (const p of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"]) {
      expect(decide(viaTailscale, env, p), p).toEqual({ allow: true, reason: "public" });
    }
    for (const p of ["/", "/tickets", "/api/items", "/api/stream", "/telefono", "/sw.js.map", "/offline"]) {
      expect(decide(viaTailscale, env, p), p).toMatchObject({ allow: false, status: 401 });
    }
  });

  it("public paths still honour the Tailscale user check", () => {
    const e = { ...env, tailscaleUser: "andres@example.com" };
    expect(decide({ ...viaTailscale, "tailscale-user-login": "x@y.z" }, e, "/manifest.webmanifest")).toMatchObject({ allow: false, status: 403 });
  });

  it("/pair opens without the cookie (its one-time code is the key)", () => {
    expect(decide(viaTailscale, env, "/pair")).toEqual({ allow: true, reason: "pair" });
  });

  it("the pairing API only answers to the PC itself, even with the token", () => {
    expect(decide(viaTailscale, env, "/api/pairing", TOKEN)).toMatchObject({ allow: false, status: 403 });
    expect(decide(viaTailscale, env, "/api/pairing/x", TOKEN)).toMatchObject({ allow: false, status: 403 });
    expect(decide({ host: "localhost:8790" }, env, "/api/pairing")).toEqual({ allow: true, reason: "local" });
  });

  it("?token= is not a credential any more", () => {
    // The guard never reads the query: a URL with the token and no cookie/header is refused.
    expect(decide(viaTailscale, env, "/")).toMatchObject({ allow: false, status: 401 });
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
  const saved = { token: process.env.MESA_TOKEN, user: process.env.MESA_TAILSCALE_USER };
  afterEach(() => {
    if (saved.token === undefined) delete process.env.MESA_TOKEN;
    else process.env.MESA_TOKEN = saved.token;
    if (saved.user === undefined) delete process.env.MESA_TAILSCALE_USER;
    else process.env.MESA_TAILSCALE_USER = saved.user;
  });
  const req = (path: string, h: Record<string, string>) => new NextRequest(`http://127.0.0.1:8790${path}`, { headers: h });

  it("answers the four cases of the access rule", () => {
    process.env.MESA_TOKEN = TOKEN;
    delete process.env.MESA_TAILSCALE_USER;
    const ts = { host: "127.0.0.1:8790", "tailscale-user-login": "andres@example.com" };
    expect(proxy(req("/", { host: "localhost:8790" })).status).toBe(200); // plain localhost: pass
    expect(proxy(req("/", ts)).status).toBe(401); // loopback Host + Tailscale headers, no token
    expect(proxy(req("/", { ...ts, cookie: `mesa_token=${TOKEN}` })).status).toBe(200); // token: pass
    process.env.MESA_TAILSCALE_USER = "andres@example.com";
    expect(proxy(req("/", { ...ts, "tailscale-user-login": "x@y.z", cookie: `mesa_token=${TOKEN}` })).status).toBe(403); // wrong login
    expect(proxy(req("/", { ...ts, cookie: `mesa_token=${TOKEN}` })).status).toBe(200); // right login + token
  });

  it("refuses forwarded requests when MESA_TOKEN is not set", () => {
    delete process.env.MESA_TOKEN;
    expect(proxy(req("/", { host: "127.0.0.1:8790", "x-forwarded-for": "100.64.0.2" })).status).toBe(403);
    expect(proxy(req("/", { host: "localhost:8790" })).status).toBe(200);
  });
});
