import { body, json, route } from "@/lib/api/http";
import { reviewOpenInput } from "@/lib/api/schemas";

/**
 * POST /api/tickets/:id/reviews { repo, pr, sha } -> { review }
 * Opens (or refreshes) the review of a PR with no findings, so a clean pass still has its card.
 * Idempotent; a new head sha reopens an approved review.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => json({ review: r.reviews.open(id, await body(req, reviewOpenInput)) }));
