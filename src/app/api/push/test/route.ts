import { body, error, json, route } from "@/lib/api/http";
import { pushStatus } from "@/lib/push/config";
import { pushSender, sendTest } from "@/lib/push/notifier";
import { endpointInput } from "@/lib/push/schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/test { endpoint } -> { ok: true }   "Probar aviso": pushes a test to that one device.
 * 404 unknown_subscription when the endpoint is not stored (or the push service just said it is gone),
 * 502 push_failed when the push service refused, 409 push_disabled without VAPID keys.
 */
export const POST = route(async (req, r) => {
  const st = pushStatus();
  if (!st.enabled) return error(409, "push_disabled", `push is off: ${st.reason}`);
  const { endpoint } = await body(req, endpointInput);
  if (!r.push.get(endpoint)) return error(404, "unknown_subscription", "this device has no stored subscription");
  const res = await sendTest(r, pushSender(), endpoint);
  if (res.removed > 0) return error(404, "unknown_subscription", "the push service no longer knows this subscription");
  if (res.sent === 0) return error(502, "push_failed", r.push.get(endpoint)?.lastError ?? "the push service refused the notification");
  return json({ ok: true });
});
