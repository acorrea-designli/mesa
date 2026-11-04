import { body, error, json, route } from "@/lib/api/http";
import { salidaTransition } from "@/lib/api/schemas";
import { gateSalidaEvent } from "@/lib/domain/sandbox";
import { isSandbox } from "@/lib/env";
import { withDestinationUrl } from "@/features/salidas/read";

/**
 * POST /api/salidas/:id/transition SalidaEvent -> SalidaDetail. 409 on an invalid transition.
 * `sent` takes `simulated: true` only in sandbox, where it is also required and the permalink
 * becomes `sandbox://<source>/<id>` (409 `sandbox` otherwise; see src/lib/domain/sandbox.ts).
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const ev = await body(req, salidaTransition);
  const gate = gateSalidaEvent(isSandbox(), r.salidas.get(id), ev);
  if (!gate.ok) return error(409, gate.code, gate.error);
  return json(withDestinationUrl(r.salidas.transition(id, gate.event)));
});
