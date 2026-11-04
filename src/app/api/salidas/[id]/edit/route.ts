import { body, json, route } from "@/lib/api/http";
import { withDestinationUrl } from "@/features/salidas/read";
import { salidaEdit } from "@/lib/api/schemas";

/** POST /api/salidas/:id/edit { body } -> SalidaDetail (manual edit by Andrés; cancels open turns) */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(withDestinationUrl(r.salidas.edit(id, (await body(req, salidaEdit)).body))));
