import { isLocalRequest } from "@/lib/access";
import { error, json, route } from "@/lib/api/http";
import { tailnetUrl } from "@/lib/tailnet";

export const dynamic = "force-dynamic";

/**
 * GET /api/pairing -> { tailnetUrl: string | null }   where the phone will connect (null: Tailscale not reachable here)
 * POST /api/pairing -> { url, expiresAt }             mint a one-time pairing link (10 min, single use) for the QR
 * Local to this PC only: src/lib/access.ts refuses it through the tunnel, and it is checked again here.
 * 409 no_tailnet when no tailnet URL is known (MESA_TAILNET_URL unset and Tailscale is not running).
 */
export const GET = route(async (req) => {
  if (!isLocalRequest(req.headers)) return error(403, "local_only", "pairing is only available from the PC Mesa runs on");
  return json({ tailnetUrl: await tailnetUrl() });
});

export const POST = route(async (req, r) => {
  if (!isLocalRequest(req.headers)) return error(403, "local_only", "pairing is only available from the PC Mesa runs on");
  const base = await tailnetUrl();
  if (!base) return error(409, "no_tailnet", "no tailnet URL: start Tailscale or set MESA_TAILNET_URL");
  const { code, expiresAt } = r.pairing.create();
  return json({ url: `${base}/pair?c=${code}`, expiresAt }, { status: 201, headers: { "cache-control": "no-store" } });
});
