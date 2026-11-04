import { z } from "zod";
import { body, json, route } from "@/lib/api/http";

const input = z.object({ note: z.string().max(2000).optional() });

/** POST /api/approvals/:id/read-config { note? } -> { approval }. UI only (Lee tus configuraciones: deny, the agent reads its own allow rules). 409 after expiry or once decided */
export const POST = route<{ id: string }>(async (req, r, { id }) =>
  json({ approval: r.approvals.decide(id, { decision: "read_config", actor: "andres", note: (await body(req, input)).note }) }),
);
