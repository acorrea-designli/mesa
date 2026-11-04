import { body, json, route } from "@/lib/api/http";
import { salidaTurn } from "@/lib/api/schemas";

/** POST /api/salidas/:id/turns { body?, marks?, chipLabel? } -> SalidaDetail (wakes the owner with salida.turn) */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(r.salidas.addTurn(id, await body(req, salidaTurn))));
