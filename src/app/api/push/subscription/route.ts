import { body, error, json, route } from "@/lib/api/http";
import { pushStatus } from "@/lib/push/config";
import { endpointInput, subscriptionInput } from "@/lib/push/schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/subscription { endpoint, keys: { p256dh, auth }, label? } -> { ok: true } (upsert by endpoint)
 * Idempotent: the phone calls it after turning notifications on and again on every page load (a re-sync that
 * survives a push service rotating the endpoint). 409 push_disabled without VAPID keys (or in the sandbox).
 */
export const POST = route(async (req, r) => {
  const st = pushStatus();
  if (!st.enabled) return error(409, "push_disabled", `push is off: ${st.reason}`);
  const i = await body(req, subscriptionInput);
  r.push.upsert({
    endpoint: i.endpoint,
    p256dh: i.keys.p256dh,
    auth: i.keys.auth,
    label: i.label ?? "",
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 200),
  });
  return json({ ok: true });
});

/** DELETE /api/push/subscription { endpoint } -> { ok: true, removed } (turning notifications off on this device) */
export const DELETE = route(async (req, r) => json({ ok: true, removed: r.push.remove((await body(req, endpointInput)).endpoint) }));
