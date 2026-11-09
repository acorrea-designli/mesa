// Phone pairing codes. The code is 32 random bytes (base64url); only its SHA-256 is stored. One active code at a
// time (minting a new one voids the previous), 10 minutes of life, single use.
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/sqlite";
import { nowIso } from "../db/util";

export const PAIRING_TTL_MS = 10 * 60_000;

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

export function pairingRepo(db: Db) {
  return {
    /** Mint a code. The plain code is returned once and never stored. */
    create(now = new Date()): { code: string; expiresAt: string } {
      const code = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
      // Housekeeping: spent or expired rows older than a day go; unused live codes are voided (one active code).
      db.prepare("DELETE FROM phone_pairings WHERE expires_at < ? OR used_at IS NOT NULL").run(new Date(now.getTime() - 24 * 3_600_000).toISOString());
      db.prepare("UPDATE phone_pairings SET used_at = ? WHERE used_at IS NULL").run(nowIso(now));
      db.prepare("INSERT INTO phone_pairings (code_hash, created_at, expires_at) VALUES (?, ?, ?)").run(hash(code), nowIso(now), expiresAt);
      return { code, expiresAt };
    },

    /** True once per valid code: the row is marked used by a single conditional UPDATE. */
    consume(code: string, now = new Date()): boolean {
      if (!code || code.length > 200) return false;
      const r = db
        .prepare("UPDATE phone_pairings SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?")
        .run(nowIso(now), hash(code), nowIso(now));
      return Number(r.changes) === 1;
    },
  };
}
