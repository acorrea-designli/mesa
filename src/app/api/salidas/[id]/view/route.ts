import { json, route } from "@/lib/api/http";
import { salidaView } from "@/features/salidas/read";

export const dynamic = "force-dynamic";

/** GET /api/salidas/:id/view -> SalidaView (t204): the card's data with the ticket and its history, for a salida opened from the Historial. */
export const GET = route<{ id: string }>((_req, r, { id }) => json(salidaView(r, id)));
