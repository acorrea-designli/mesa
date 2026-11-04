import { body, json, route } from "@/lib/api/http";
import { salidaTransition } from "@/lib/api/schemas";

/** POST /api/salidas/:id/transition SalidaEvent -> SalidaDetail. 409 on an invalid transition */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(r.salidas.transition(id, await body(req, salidaTransition))));
