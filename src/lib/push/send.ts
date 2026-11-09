// Sending to subscriptions. The sender is injectable (tests mock it, production wraps `web-push`).
// A push service that answers 404 or 410 says the subscription is gone for good: the row is deleted.
import type { Repos } from "../repo";
import type { PushSubscriptionRow } from "../repo/push";
import type { VapidConfig } from "./config";
import { encodePayload, type PushPayload } from "./payload";

export type SendOutcome = { ok: true } | { ok: false; status: number | null; message: string };

export interface SubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type Sender = (sub: SubscriptionKeys, body: string) => Promise<SendOutcome>;

/** Hold a notification at the push service for at most 12 hours (a phone that is off still gets it when it wakes). */
const TTL_SECONDS = 12 * 3600;
const TIMEOUT_MS = 15_000;

/** The production sender: web-push with the VAPID keys. Imported lazily, so tests and the sandbox never load it. */
export function webPushSender(cfg: VapidConfig): Sender {
  return async (sub, body) => {
    const webpush = await import("web-push");
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, {
        vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
        TTL: TTL_SECONDS,
        urgency: "high",
        timeout: TIMEOUT_MS,
      });
      return { ok: true };
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      return { ok: false, status: typeof e.statusCode === "number" ? e.statusCode : null, message: e.message ?? "send failed" };
    }
  };
}

export interface DeliverResult {
  sent: number;
  removed: number;
  failed: number;
}

/** Send one payload to the given subscriptions, recording the outcome of each. */
export async function deliver(
  push: Repos["push"],
  sender: Sender,
  subs: PushSubscriptionRow[],
  payload: PushPayload,
  now = new Date(),
): Promise<DeliverResult> {
  const body = encodePayload(payload);
  const result: DeliverResult = { sent: 0, removed: 0, failed: 0 };
  await Promise.all(
    subs.map(async (s) => {
      let out: SendOutcome;
      try {
        out = await sender(s, body);
      } catch (err) {
        out = { ok: false, status: null, message: err instanceof Error ? err.message : "send failed" };
      }
      if (out.ok) {
        push.markOk(s.endpoint, now);
        result.sent++;
      } else if (out.status === 404 || out.status === 410) {
        push.remove(s.endpoint);
        result.removed++;
      } else {
        push.markError(s.endpoint, out.status ? `${out.status}: ${out.message}` : out.message);
        result.failed++;
      }
    }),
  );
  return result;
}
