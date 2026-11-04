import { body, json, route } from "@/lib/api/http";
import { sweepInput } from "@/lib/api/schemas";

/** POST /api/sweep { sources? } -> { event } ("Barrer ahora": wakes the lead with sweep.requested) */
export const POST = route(async (req, r) => json({ event: r.requestSweep((await body(req, sweepInput)).sources) }, { status: 202 }));
