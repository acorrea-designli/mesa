import { error, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/engram/search?q=&project=&limit=5 -> { status: "connected" | "offline", observations: EngramObservation[] }
 * Lane C implements this with the engram CLI (read only). Until then it answers 501.
 */
export const GET = route(() => error(501, "not_implemented", "engram search is not wired yet (lane C)"));
