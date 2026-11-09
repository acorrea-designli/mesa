import { describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos } from ".";
import { FAILURE_WINDOW_MS, MAX_FAILURES, PAIRING_TTL_MS, SHORT_ALPHABET, SHORT_LENGTH, formatShort, normalizeShort } from "./pairing";

const T0 = new Date("2026-11-09T12:00:00Z");
const mk = () => createRepos(openDb(":memory:")).pairing;
const later = (ms: number) => new Date(T0.getTime() + ms);

describe("phone pairing codes", () => {
  it("a code works once", () => {
    const p = mk();
    const { code } = p.create(T0);
    expect(p.redeem(code, T0)).toBe("ok");
    expect(p.redeem(code, T0)).toBe("used");
  });

  it("expires after 10 minutes", () => {
    const p = mk();
    const { code, expiresAt } = p.create(T0);
    expect(Date.parse(expiresAt) - T0.getTime()).toBe(PAIRING_TTL_MS);
    expect(p.redeem(code, later(PAIRING_TTL_MS + 1))).toBe("expired");
    const again = p.create(T0).code;
    expect(p.redeem(again, later(PAIRING_TTL_MS - 1))).toBe("ok");
  });

  it("rejects unknown, empty and oversized codes", () => {
    const p = mk();
    p.create(T0);
    expect(p.redeem("nope", T0)).toBe("invalid");
    expect(p.redeem("", T0)).toBe("invalid");
    expect(p.redeem("x".repeat(500), T0)).toBe("invalid");
  });

  it("minting a new code voids the previous one", () => {
    const p = mk();
    const a = p.create(T0);
    const b = p.create(T0);
    expect(p.redeem(a.code, T0)).toBe("used");
    expect(p.redeem(a.short, T0)).toBe("used");
    expect(p.redeem(b.code, T0)).toBe("ok");
  });

  it("tells used, expired and invalid apart, and every miss counts toward the limiter", () => {
    const p = mk();
    const a = p.create(T0);
    expect(p.redeem(a.code, T0)).toBe("ok");
    const b = p.create(later(1000));
    const tm = later(PAIRING_TTL_MS + 2000);
    expect(p.redeem(a.code, tm)).toBe("used"); // spent by the QR
    expect(p.redeem(a.short, tm)).toBe("used"); // the typed form of the same code
    expect(p.redeem(b.short, tm)).toBe("expired");
    expect(p.redeem("ZZZZZZZZ", tm)).toBe("invalid"); // no such row
    expect(p.redeem("nope", tm)).toBe("invalid");
    // 5 misses (used, used, expired, invalid, invalid): the next try is limited even for a live code.
    const c = p.create(tm);
    expect(p.redeem(c.short, tm)).toBe("limited");
  });

  it("status: the newest code's state, never the code", () => {
    const p = mk();
    expect(p.status(T0)).toEqual({ state: "none", expiresAt: null });
    const a = p.create(T0);
    expect(p.status(later(1000)).state).toBe("active");
    expect(p.status(later(PAIRING_TTL_MS + 1)).state).toBe("expired");
    p.redeem(a.code, later(1000));
    expect(p.status(later(2000)).state).toBe("used");
    const b = p.create(later(3000));
    expect(p.status(later(3000)).state).toBe("active");
    p.create(later(4000)); // voids b
    expect(p.redeem(b.short, later(4000))).toBe("used");
    expect(JSON.stringify(p.status(later(4000)))).not.toContain(b.code);
  });

  it("stores only hashes, never the codes", () => {
    const db = openDb(":memory:");
    const { code, short } = createRepos(db).pairing.create(T0);
    const rows = db.prepare("SELECT * FROM phone_pairings").all() as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(JSON.stringify(rows)).not.toContain(short);
    expect(rows[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.short_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("short code", () => {
  it("is 8 characters of the unambiguous alphabet", () => {
    const p = mk();
    for (let i = 0; i < 50; i++) {
      const { short } = p.create(T0);
      expect(short).toHaveLength(SHORT_LENGTH);
      expect([...short].every((c) => SHORT_ALPHABET.includes(c))).toBe(true);
    }
    for (const bad of ["0", "O", "1", "I", "L"]) expect(SHORT_ALPHABET).not.toContain(bad);
  });

  it("redeems once, in any case and with or without the dash, and shares its single use with the long code", () => {
    const p = mk();
    const a = p.create(T0);
    expect(p.redeem(` ${formatShort(a.short).toLowerCase()} `, T0)).toBe("ok");
    expect(p.redeem(a.short, T0)).toBe("used");
    expect(p.redeem(a.code, T0)).toBe("used");
    const b = p.create(T0);
    expect(p.redeem(b.code, T0)).toBe("ok");
    expect(p.redeem(b.short, T0)).toBe("used");
  });

  it("expires with the long code", () => {
    const p = mk();
    const { short } = p.create(T0);
    expect(p.redeem(short, later(PAIRING_TTL_MS + 1))).toBe("expired");
  });

  it("formats and normalizes", () => {
    expect(formatShort("ABCD2345")).toBe("ABCD-2345");
    expect(normalizeShort(" abcd-2345 ")).toBe("ABCD2345");
  });
});

describe("failed tries", () => {
  it("5 wrong tries in 10 minutes block even the right code (limited), until they age out", () => {
    const p = mk();
    const { short } = p.create(T0);
    for (let i = 0; i < MAX_FAILURES; i++) expect(p.redeem("WRONG234", later(i * 1000))).toBe("invalid");
    expect(p.redeem(short, later(10_000))).toBe("limited");
    expect(p.redeem("WRONG234", later(11_000))).toBe("limited");
    expect(p.redeem(short, later(FAILURE_WINDOW_MS + MAX_FAILURES * 1000 + 1))).toBe("expired"); // the code expired meanwhile
  });

  it("4 wrong tries then the right code works and clears the counter", () => {
    const p = mk();
    const { short } = p.create(T0);
    for (let i = 0; i < MAX_FAILURES - 1; i++) p.redeem("WRONG234", later(i));
    expect(p.redeem(short, later(10))).toBe("ok");
    const next = p.create(later(20));
    for (let i = 0; i < MAX_FAILURES - 1; i++) p.redeem("WRONG234", later(30 + i));
    expect(p.redeem(next.short, later(40))).toBe("ok");
  });

  it("after the window the limit lifts and a fresh code works", () => {
    const p = mk();
    for (let i = 0; i < MAX_FAILURES; i++) p.redeem("WRONG234", T0);
    expect(p.redeem("WRONG234", later(1000))).toBe("limited");
    const t = later(FAILURE_WINDOW_MS + 1000);
    const { short } = p.create(t);
    expect(p.redeem(short, t)).toBe("ok");
  });
});
