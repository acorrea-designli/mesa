import { describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos } from ".";
import { PAIRING_TTL_MS } from "./pairing";

const T0 = new Date("2026-11-09T12:00:00Z");
const mk = () => createRepos(openDb(":memory:")).pairing;

describe("phone pairing codes", () => {
  it("a code works once", () => {
    const p = mk();
    const { code } = p.create(T0);
    expect(p.consume(code, T0)).toBe(true);
    expect(p.consume(code, T0)).toBe(false);
  });

  it("expires after 10 minutes", () => {
    const p = mk();
    const { code, expiresAt } = p.create(T0);
    expect(Date.parse(expiresAt) - T0.getTime()).toBe(PAIRING_TTL_MS);
    expect(p.consume(code, new Date(T0.getTime() + PAIRING_TTL_MS + 1))).toBe(false);
    const again = p.create(T0).code;
    expect(p.consume(again, new Date(T0.getTime() + PAIRING_TTL_MS - 1))).toBe(true);
  });

  it("rejects unknown, empty and oversized codes", () => {
    const p = mk();
    p.create(T0);
    expect(p.consume("nope", T0)).toBe(false);
    expect(p.consume("", T0)).toBe(false);
    expect(p.consume("x".repeat(500), T0)).toBe(false);
  });

  it("minting a new code voids the previous one", () => {
    const p = mk();
    const a = p.create(T0).code;
    const b = p.create(T0).code;
    expect(p.consume(a, T0)).toBe(false);
    expect(p.consume(b, T0)).toBe(true);
  });

  it("stores only a hash, never the code", () => {
    const db = openDb(":memory:");
    const { code } = createRepos(db).pairing.create(T0);
    const rows = db.prepare("SELECT * FROM phone_pairings").all() as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(rows[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
