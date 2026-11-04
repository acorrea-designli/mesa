import { body, json, route } from "@/lib/api/http";
import { withDestinationUrl } from "@/features/salidas/read";
import { salidaVersion } from "@/lib/api/schemas";

/** POST /api/salidas/:id/versions { body, author?, turnId?, chipLabel? } -> SalidaDetail (new version becomes current) */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(withDestinationUrl(r.salidas.addVersion(id, await body(req, salidaVersion)))));
