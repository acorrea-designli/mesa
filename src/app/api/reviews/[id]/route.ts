import { json, route } from "@/lib/api/http";

/** GET /api/reviews/:id -> { review } */
export const GET = route<{ id: string }>((_req, r, { id }) => json({ review: r.reviews.get(id) }));
