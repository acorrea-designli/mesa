// Web Push subscriptions and the push notifier's persistent state (t33). One row per device; the endpoint is unique,
// so subscribing again (every page load re-syncs) updates the keys in place and keeps the delivery history.
import type { Db } from "../db/sqlite";
import { nowIso } from "../db/util";
import type { Seen } from "@/features/notify/decide";

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
  userAgent: string;
  createdAt: string;
  lastOkAt: string | null;
  lastError: string | null;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  label?: string;
  userAgent?: string;
}

const SEEN_KEY = "push.seen";
const SCAN_KEY = "push.last_scan";

interface Raw {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
  user_agent: string;
  created_at: string;
  last_ok_at: string | null;
  last_error: string | null;
}

const map = (r: Raw): PushSubscriptionRow => ({
  id: r.id,
  endpoint: r.endpoint,
  p256dh: r.p256dh,
  auth: r.auth,
  label: r.label,
  userAgent: r.user_agent,
  createdAt: r.created_at,
  lastOkAt: r.last_ok_at,
  lastError: r.last_error,
});

export function pushRepo(db: Db) {
  const setting = (key: string): string | null => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  };
  const putSetting = (key: string, value: string) =>
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);

  return {
    /** Insert or refresh a subscription (same endpoint): keys, label and agent are updated, history is kept. */
    upsert(i: PushSubscriptionInput, now = new Date()): PushSubscriptionRow {
      db.prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, user_agent = excluded.user_agent`,
      ).run(i.endpoint, i.p256dh, i.auth, i.label ?? "", i.userAgent ?? "", nowIso(now));
      return this.get(i.endpoint)!;
    },

    get(endpoint: string): PushSubscriptionRow | null {
      const row = db.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?").get(endpoint) as Raw | undefined;
      return row ? map(row) : null;
    },

    list(): PushSubscriptionRow[] {
      return (db.prepare("SELECT * FROM push_subscriptions ORDER BY id").all() as unknown as Raw[]).map(map);
    },

    count(): number {
      return (db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n;
    },

    /** True when a row was deleted. */
    remove(endpoint: string): boolean {
      return Number(db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint).changes) > 0;
    },

    markOk(endpoint: string, now = new Date()): void {
      db.prepare("UPDATE push_subscriptions SET last_ok_at = ?, last_error = NULL WHERE endpoint = ?").run(nowIso(now), endpoint);
    },

    markError(endpoint: string, message: string): void {
      db.prepare("UPDATE push_subscriptions SET last_error = ? WHERE endpoint = ?").run(message.slice(0, 200), endpoint);
    },

    // ----- notifier state -----

    /** Keys already handled (same shape as the desktop notifier's localStorage set). */
    seen(): Seen {
      const raw = setting(SEEN_KEY);
      if (raw === null) return {};
      try {
        const v = JSON.parse(raw) as unknown;
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Seen) : {};
      } catch {
        return {};
      }
    },

    /** Time (epoch ms) of the last successful scan, or null when there is none. */
    lastScan(): number | null {
      const raw = setting(SCAN_KEY);
      const n = raw === null ? NaN : Number(raw);
      return Number.isFinite(n) ? n : null;
    },

    saveScan(seen: Seen, at: number): void {
      putSetting(SEEN_KEY, JSON.stringify(seen));
      putSetting(SCAN_KEY, String(at));
    },
  };
}
