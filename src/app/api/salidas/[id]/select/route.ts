import { body, json, route } from "@/lib/api/http";
import { withDestinationUrl } from "@/features/salidas/read";
import { salidaSelect } from "@/lib/api/schemas";

/** POST /api/salidas/:id/select { n } -> SalidaDetail (go back to vN: Aprobar now sends vN) */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(withDestinationUrl(r.salidas.selectVersion(id, (await body(req, salidaSelect)).n))));
