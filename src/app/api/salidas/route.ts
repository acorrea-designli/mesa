import { body, json, query, route } from "@/lib/api/http";
import { salidaInput } from "@/lib/api/schemas";
import type { SalidaStatus } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

/** GET /api/salidas?status=pending,scheduled -> Salida[] */
export const GET = route((req, r) => {
  const st = query(req).get("status");
  return json(r.salidas.list({ status: st ? (st.split(",") as SalidaStatus[]) : undefined }));
});

/** POST /api/salidas SalidaInput -> SalidaDetail (201) with v1 */
export const POST = route(async (req, r) => json(r.salidas.create(await body(req, salidaInput)), { status: 201 }));
