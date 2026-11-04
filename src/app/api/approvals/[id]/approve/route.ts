import { z } from "zod";
import { body, json, route } from "@/lib/api/http";

const input = z.object({ note: z.string().max(2000).optional() });

/** POST /api/approvals/:id/approve { note? } -> { approval }. UI only (Dar permiso: allow this one call). 409 after expiry or once decided */
export const POST = route<{ id: string }>(async (req, r, { id }) =>
  json({ approval: r.approvals.decide(id, { decision: "allow", actor: "andres", note: (await body(req, input)).note }) }),
);
