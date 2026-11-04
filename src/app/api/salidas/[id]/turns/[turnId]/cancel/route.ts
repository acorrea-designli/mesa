import { json, route } from "@/lib/api/http";

/** POST /api/salidas/:id/turns/:turnId/cancel -> SalidaDetail (cancel the pending rewrite) */
export const POST = route<{ id: string; turnId: string }>((_req, r, { id, turnId }) => json(r.salidas.cancelTurn(id, turnId)));
