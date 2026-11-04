import { body, json, route } from "@/lib/api/http";
import { salidaStar } from "@/lib/api/schemas";

/** PATCH /api/salidas/:id/versions/:n { starred } -> SalidaDetail */
export const PATCH = route<{ id: string; n: string }>(async (req, r, { id, n }) =>
  json(r.salidas.star(id, Number(n), (await body(req, salidaStar)).starred)),
);
