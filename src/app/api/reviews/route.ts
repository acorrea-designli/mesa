import { json, query, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/** GET /api/reviews?ticket= -> { reviews } (with findings) */
export const GET = route((req, r) => json({ reviews: r.reviews.list({ ticket: query(req).get("ticket") ?? undefined }) }));
