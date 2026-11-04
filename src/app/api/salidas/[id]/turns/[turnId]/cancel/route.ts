import { json, route } from "@/lib/api/http";
import { withDestinationUrl } from "@/features/salidas/read";

/** POST /api/salidas/:id/turns/:turnId/cancel -> SalidaDetail (cancel the pending rewrite) */
export const POST = route<{ id: string; turnId: string }>((_req, r, { id, turnId }) => json(withDestinationUrl(r.salidas.cancelTurn(id, turnId))));
