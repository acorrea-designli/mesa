import { json, route } from "@/lib/api/http";

/** GET /api/salidas/:id -> SalidaDetail (versions, turns, engram links) */
export const GET = route<{ id: string }>((_req, r, { id }) => json(r.salidas.detail(id)));
