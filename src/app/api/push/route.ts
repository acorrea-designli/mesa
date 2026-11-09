import { json, route } from "@/lib/api/http";
import { pushStatus } from "@/lib/push/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/push -> { enabled: true, publicKey, subscriptions } | { enabled: false, reason: "no_keys" | "sandbox", subscriptions }
 * Whether the server can send Web Push, and the VAPID public key a device subscribes with.
 */
export const GET = route((_req, r) => json({ ...pushStatus(), subscriptions: r.push.count() }, { headers: { "cache-control": "no-store" } }));
