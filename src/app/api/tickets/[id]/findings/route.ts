import { body, json, route } from "@/lib/api/http";
import { findingInput } from "@/lib/api/schemas";

/** GET /api/tickets/:id/findings -> { findings } */
export const GET = route<{ id: string }>((_req, r, { id }) => json({ findings: r.reviews.findings(id) }));

/** POST /api/tickets/:id/findings FindingInput -> { finding } (upsert by repo, pr, n) */
export const POST = route<{ id: string }>(async (req, r, { id }) => json({ finding: r.reviews.upsertFinding(id, await body(req, findingInput)) }));
