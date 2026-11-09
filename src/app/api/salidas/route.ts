import { body, json, query, route } from "@/lib/api/http";
import { withDestinationUrl } from "@/features/salidas/read";
import { salidaInput } from "@/lib/api/schemas";
import type { SalidaStatus } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

/** GET /api/salidas?status=pending,scheduled -> Salida[] */
export const GET = route((req, r) => {
  const st = query(req).get("status");
  return json(r.salidas.list({ status: st ? (st.split(",") as SalidaStatus[]) : undefined }));
});

/** POST /api/salidas SalidaInput -> SalidaDetail (201) with v1 */
export const POST = route(async (req, r) => {
  const input = await body(req, salidaInput);
  // ticketId is an id or a ref (t22); store the id. An unknown one is a 404, not a FOREIGN KEY 500.
  const ticketId = input.ticketId ? r.tickets.get(input.ticketId).id : undefined;
  return json(withDestinationUrl(r.salidas.create({ ...input, ticketId })), { status: 201 });
});
