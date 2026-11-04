import { json, route } from "@/lib/api/http";
import { withDestinationUrl } from "@/features/salidas/read";

/** GET /api/salidas/:id -> SalidaDetail + destinationUrl (versions, turns, engram links) */
export const GET = route<{ id: string }>((_req, r, { id }) => json(withDestinationUrl(r.salidas.detail(id))));
