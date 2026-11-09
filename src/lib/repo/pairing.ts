// Phone pairing codes. Two forms of the same one-time code: the long one is 32 random bytes (base64url) and rides in the
// QR link; the short one is 8 characters from an unambiguous alphabet, shown on /telefono to be typed inside an
// installed app. Only SHA-256 hashes are stored. One active code at a time (minting a new one voids the previous), 10
// minutes of life, single use. Wrong tries are counted: 5 failures in 10 minutes block redeeming until they age out.
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Db } from "../db/sqlite";
import { nowIso } from "../db/util";

export const PAIRING_TTL_MS = 10 * 60_000;
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 10 * 60_000;

/** No 0/O, 1/I/L: a code read off a screen and typed on a phone must not be ambiguous. */
export const SHORT_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const SHORT_LENGTH = 8;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const shortHash = (short: string) => hash(`short:${short}`);

/** What the person typed -> the canonical 8 characters: upper case, without spaces or dashes. */
export function normalizeShort(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

const isShort = (s: string) => s.length === SHORT_LENGTH && [...s].every((c) => SHORT_ALPHABET.includes(c));

/** "ABCD-EFGH", how it is shown. */
export const formatShort = (short: string) => `${short.slice(0, 4)}-${short.slice(4)}`;

/** ok; used (row matched, used_at set); expired (matched, unused, past expires_at); invalid (no match); limited (5 misses in 10 min). */
export type Redeem = "ok" | "used" | "expired" | "invalid" | "limited";

export function pairingRepo(db: Db) {
  const failuresSince = (now: Date) =>
    Number((db.prepare("SELECT COUNT(*) AS n FROM pair_failures WHERE at > ?").get(nowIso(new Date(now.getTime() - FAILURE_WINDOW_MS))) as { n: number }).n);

  return {
    /** Mint a code pair. The plain codes are returned once and never stored. `short` is the canonical form (no dash). */
    create(now = new Date()): { code: string; short: string; expiresAt: string } {
      const code = randomBytes(32).toString("base64url");
      const short = Array.from({ length: SHORT_LENGTH }, () => SHORT_ALPHABET[randomInt(SHORT_ALPHABET.length)]).join("");
      const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
      // Housekeeping: rows that expired more than a day ago go (spent ones too: a spent code must keep answering "used"
      // for that day, so it is not dropped the moment a newer one is minted); unused live codes are voided (one active code).
      db.prepare("DELETE FROM phone_pairings WHERE expires_at < ?").run(new Date(now.getTime() - 24 * 3_600_000).toISOString());
      db.prepare("UPDATE phone_pairings SET used_at = ? WHERE used_at IS NULL").run(nowIso(now));
      db.prepare("INSERT INTO phone_pairings (code_hash, short_hash, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hash(code), shortHash(short), nowIso(now), expiresAt);
      return { code, short, expiresAt };
    },

    /**
     * Redeem a typed or scanned code (long or short form). "limited" when 5 wrong tries happened in the last 10
     * minutes: the code is not even checked then, so guessing cannot go on. A success clears the counter. A single
     * conditional UPDATE marks the row used, so a code works once.
     */
    redeem(input: string, now = new Date()): Redeem {
      if (failuresSince(now) >= MAX_FAILURES) return "limited";
      const raw = (input ?? "").trim();
      let miss: "invalid" | "used" | "expired" = "invalid";
      if (raw && raw.length <= 200) {
        const short = normalizeShort(raw);
        const [col, h] = isShort(short) ? (["short_hash", shortHash(short)] as const) : (["code_hash", hash(raw)] as const);
        const r = db.prepare(`UPDATE phone_pairings SET used_at = ? WHERE ${col} = ? AND used_at IS NULL AND expires_at > ?`).run(nowIso(now), h, nowIso(now));
        if (Number(r.changes) === 1) {
          db.prepare("DELETE FROM pair_failures").run();
          return "ok";
        }
        // Not redeemed: say why. A matched row with used_at set was spent (by the QR or the typed code) or voided by a newer one.
        const row = db.prepare(`SELECT used_at, expires_at FROM phone_pairings WHERE ${col} = ?`).get(h) as { used_at: string | null; expires_at: string } | undefined;
        if (row) miss = row.used_at ? "used" : "expired";
      }
      db.prepare("DELETE FROM pair_failures WHERE at <= ?").run(nowIso(new Date(now.getTime() - FAILURE_WINDOW_MS)));
      db.prepare("INSERT INTO pair_failures (at) VALUES (?)").run(nowIso(now));
      return miss;
    },

    /**
     * The newest code's state for /telefono on the PC: "active" (unused, not expired), "used" (spent by the QR or the
     * typed code, or voided by a newer one), "expired", or "none". Never returns a code.
     */
    status(now = new Date()): { state: "none" | "active" | "used" | "expired"; expiresAt: string | null } {
      const row = db.prepare("SELECT used_at, expires_at FROM phone_pairings ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as { used_at: string | null; expires_at: string } | undefined;
      if (!row) return { state: "none", expiresAt: null };
      if (row.used_at) return { state: "used", expiresAt: row.expires_at };
      return { state: row.expires_at > nowIso(now) ? "active" : "expired", expiresAt: row.expires_at };
    },
  };
}
