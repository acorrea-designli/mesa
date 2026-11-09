import { beforeAll, describe, expect, it } from "vitest";
import { cfAccessConfig, createKeyStore, normalizeTeam, verifyAccessJwt } from "./cf-access";
import { CFG, NOW_MS, NOW_S, makeKey, signJwt, storeFor, type TestKey } from "./cf-access-testkit";

let key: TestKey;
let other: TestKey;
beforeAll(async () => {
  key = await makeKey("kid-1");
  other = await makeKey("kid-1"); // same kid, different key: a forged signature
});

const verify = (token: string | null | undefined, keys: () => TestKey[] = () => [key]) => verifyAccessJwt(token, CFG, storeFor(keys).store, NOW_MS);

describe("verifyAccessJwt", () => {
  it("accepts a valid token and returns the email", async () => {
    expect(await verify(await signJwt(key))).toEqual({ ok: true, email: "andres@example.com" });
  });

  it("compares the email case-insensitively and finds the aud among several, or as a plain string", async () => {
    expect(await verify(await signJwt(key, { email: "Andres@Example.COM" }))).toMatchObject({ ok: true });
    expect(await verify(await signJwt(key, { aud: ["other", CFG.aud] }))).toMatchObject({ ok: true });
    expect(await verify(await signJwt(key, { aud: CFG.aud }))).toMatchObject({ ok: true });
  });

  it("refuses a wrong aud", async () => {
    expect(await verify(await signJwt(key, { aud: ["someone-elses-app"] }))).toEqual({ ok: false, reason: "aud" });
    expect(await verify(await signJwt(key, { aud: undefined }))).toEqual({ ok: false, reason: "aud" });
  });

  it("refuses another email, or none", async () => {
    expect(await verify(await signJwt(key, { email: "mallory@example.com" }))).toEqual({ ok: false, reason: "email" });
    expect(await verify(await signJwt(key, { email: undefined }))).toEqual({ ok: false, reason: "email" });
  });

  it("refuses an expired token and one not valid yet", async () => {
    expect(await verify(await signJwt(key, { exp: NOW_S - 1 }))).toEqual({ ok: false, reason: "exp" });
    expect(await verify(await signJwt(key, { exp: undefined }))).toEqual({ ok: false, reason: "exp" });
    expect(await verify(await signJwt(key, { nbf: NOW_S + 3600 }))).toEqual({ ok: false, reason: "nbf" });
  });

  it("refuses another issuer", async () => {
    expect(await verify(await signJwt(key, { iss: "https://evil.cloudflareaccess.com" }))).toEqual({ ok: false, reason: "iss" });
  });

  it("refuses a bad signature (signed by another key, or a tampered payload)", async () => {
    expect(await verify(await signJwt(other))).toEqual({ ok: false, reason: "signature" });
    const t = await signJwt(key);
    const [h, , s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ iss: `https://${CFG.team}`, aud: [CFG.aud], email: CFG.email, exp: NOW_S + 99999 })).toString("base64url");
    expect(await verify(`${h}.${forged}.${s}`)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses an unknown kid, after refetching the keys once", async () => {
    const stranger = await makeKey("kid-unknown");
    const { store, calls } = storeFor(() => [key]);
    expect(await verifyAccessJwt(await signJwt(key), CFG, store, NOW_MS)).toMatchObject({ ok: true });
    expect(calls.n).toBe(1);
    expect(await verifyAccessJwt(await signJwt(stranger), CFG, store, NOW_MS)).toEqual({ ok: false, reason: "unknown_kid" });
    expect(calls.n).toBe(2); // one refetch, not a loop
  });

  it("picks up a rotated key through that one refetch", async () => {
    const rotated = await makeKey("kid-2");
    let published: TestKey[] = [key];
    const { store, calls } = storeFor(() => published);
    expect(await verifyAccessJwt(await signJwt(key), CFG, store, NOW_MS)).toMatchObject({ ok: true });
    published = [key, rotated];
    expect(await verifyAccessJwt(await signJwt(rotated), CFG, store, NOW_MS)).toMatchObject({ ok: true });
    expect(calls.n).toBe(2);
  });

  it("an unknown kid does not refetch more often than the refetch gap", async () => {
    const stranger = await makeKey("kid-unknown");
    let t = NOW_MS;
    const { store, calls } = storeFor(() => [key], { now: () => t, refetchGapMs: 30_000 });
    await verifyAccessJwt(await signJwt(key), CFG, store, t);
    for (let i = 0; i < 5; i++) await verifyAccessJwt(await signJwt(stranger), CFG, store, t);
    expect(calls.n).toBe(1);
    t += 31_000;
    await verifyAccessJwt(await signJwt(stranger), CFG, store, t);
    expect(calls.n).toBe(2);
  });

  it("caches the keys for the TTL, then fetches again", async () => {
    let t = NOW_MS;
    const calls = { n: 0 };
    const store = createKeyStore({
      now: () => t,
      ttlMs: 1000,
      fetchJson: async () => {
        calls.n++;
        return { keys: [key.jwk] };
      },
    });
    const token = await signJwt(key);
    await verifyAccessJwt(token, CFG, store, NOW_MS);
    await verifyAccessJwt(token, CFG, store, NOW_MS);
    expect(calls.n).toBe(1);
    t += 1001;
    await verifyAccessJwt(token, CFG, store, NOW_MS);
    expect(calls.n).toBe(2);
  });

  it("fails closed when the certs are unreachable or unusable", async () => {
    const token = await signJwt(key);
    const down = createKeyStore({
      fetchJson: async () => {
        throw new Error("network");
      },
    });
    expect(await verifyAccessJwt(token, CFG, down, NOW_MS)).toEqual({ ok: false, reason: "certs_unreachable" });
    const empty = createKeyStore({ fetchJson: async () => ({ keys: [] }) });
    expect(await verifyAccessJwt(token, CFG, empty, NOW_MS)).toEqual({ ok: false, reason: "certs_unreachable" });
    const junk = createKeyStore({ fetchJson: async () => "<html>" });
    expect(await verifyAccessJwt(token, CFG, junk, NOW_MS)).toEqual({ ok: false, reason: "certs_unreachable" });
  });

  it("after a failed fetch it fails fast for a moment instead of hammering the endpoint", async () => {
    let t = NOW_MS;
    const calls = { n: 0 };
    const store = createKeyStore({
      now: () => t,
      failGapMs: 5000,
      fetchJson: async () => {
        calls.n++;
        throw new Error("down");
      },
    });
    const token = await signJwt(key);
    for (let i = 0; i < 4; i++) await verifyAccessJwt(token, CFG, store, NOW_MS);
    expect(calls.n).toBe(1);
    t += 6000;
    await verifyAccessJwt(token, CFG, store, NOW_MS);
    expect(calls.n).toBe(2);
  });

  it("refuses a missing or malformed token, and any algorithm but RS256", async () => {
    for (const t of [null, undefined, "", "abc", "a.b", "a.b.c", "..", "x.y.z.w"]) expect(await verify(t), String(t)).toMatchObject({ ok: false });
    expect(await verify(null)).toEqual({ ok: false, reason: "missing" });
    expect(await verify(await signJwt(key, {}, { alg: "none" }))).toEqual({ ok: false, reason: "alg" });
    expect(await verify(await signJwt(key, {}, { alg: "HS256" }))).toEqual({ ok: false, reason: "alg" });
    expect(await verify(await signJwt(key, {}, { kid: undefined }))).toEqual({ ok: false, reason: "alg" });
  });
});

describe("cfAccessConfig", () => {
  const env = { MESA_CF_ACCESS_TEAM: "acme.cloudflareaccess.com", MESA_CF_ACCESS_AUD: "aud1", MESA_CF_ACCESS_EMAIL: "a@b.co" };
  it("needs all three", () => {
    expect(cfAccessConfig(env)).toEqual({ team: "acme.cloudflareaccess.com", aud: "aud1", email: "a@b.co" });
    for (const k of Object.keys(env)) expect(cfAccessConfig({ ...env, [k]: "" }), k).toBeNull();
    expect(cfAccessConfig({})).toBeNull();
  });
  it("accepts the team with a scheme or slash, rejects junk", () => {
    expect(normalizeTeam("https://Acme.cloudflareaccess.com/")).toBe("acme.cloudflareaccess.com");
    for (const bad of ["", "acme", "acme.com/evil", "a b.com", "https://", undefined]) expect(normalizeTeam(bad), String(bad)).toBeNull();
  });
});
