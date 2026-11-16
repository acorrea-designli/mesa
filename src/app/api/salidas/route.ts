import { body, json, query, route } from "@/lib/api/http";
import { withDestinationUrl } from "@/features/salidas/read";
import { salidaInput } from "@/lib/api/schemas";
import type { Destination, SalidaStatus } from "@/lib/domain/types";
import { resolveSalidaFiles } from "@/lib/repo/salida-files";

export const dynamic = "force-dynamic";

/** GET /api/salidas?status=pending,scheduled -> Salida[] */
export const GET = route((req, r) => {
  const st = query(req).get("status");
  return json(r.salidas.list({ status: st ? (st.split(",") as SalidaStatus[]) : undefined }));
});

/**
 * POST /api/salidas SalidaInput -> SalidaDetail (201) with v1.
 * A Basecamp destination may carry `files` (t196): each path must exist and fit; Mesa stores name, size and SHA-256 now.
 */
export const POST = route(async (req, r) => {
  const input = await body(req, salidaInput);
  // ticketId is an id or a ref (t22); store the id. An unknown one is a 404, not a FOREIGN KEY 500.
  const ticketId = input.ticketId ? r.tickets.get(input.ticketId).id : undefined;
  let destination = input.destination as Destination;
  if ("files" in input.destination && input.destination.files?.length) {
    destination = { ...input.destination, files: resolveSalidaFiles(input.destination.files) } as Destination;
  }
  return json(withDestinationUrl(r.salidas.create({ ...input, destination, ticketId })), { status: 201 });
});
