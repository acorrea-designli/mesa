import { isLocalRequest } from "@/lib/access";
import { error, json, route } from "@/lib/api/http";
import { publicUrl } from "@/lib/public-url";
import { formatShort } from "@/lib/repo/pairing";

export const dynamic = "force-dynamic";

/**
 * GET /api/pairing -> { publicUrl: string | null }   where the phone will connect (null: MESA_PUBLIC_URL is not set)
 * POST /api/pairing -> { url, code, expiresAt }      mint a one-time pairing (10 min, single use): `url` is the link inside
 *   the QR, `code` the 8-character short code ("ABCD-EFGH") for typing inside an installed app.
 * Local to this PC only: src/lib/access.ts refuses it through the tunnel, and it is checked again here.
 * 409 no_public_url when MESA_PUBLIC_URL is unset.
 */
export const GET = route(async (req) => {
  if (!isLocalRequest(req.headers)) return error(403, "local_only", "pairing is only available from the PC Mesa runs on");
  return json({ publicUrl: publicUrl() });
});

export const POST = route(async (req, r) => {
  if (!isLocalRequest(req.headers)) return error(403, "local_only", "pairing is only available from the PC Mesa runs on");
  const base = publicUrl();
  if (!base) return error(409, "no_public_url", "MESA_PUBLIC_URL is not set (https://mesa.<your domain>)");
  const { code, short, expiresAt } = r.pairing.create();
  return json({ url: `${base}/pair?c=${code}`, code: formatShort(short), expiresAt }, { status: 201, headers: { "cache-control": "no-store" } });
});
