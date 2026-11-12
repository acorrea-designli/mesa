import { body, json, route } from "@/lib/api/http";
import { reviewCloseInput } from "@/lib/api/schemas";

/**
 * POST /api/reviews/:id/close { reason } -> { review }. The lead's cleanup of a stale review card (`mesa review close`),
 * never Andrés's buttons (those are /actions). 409 unless the review is open (approving, approved and closed are
 * refused). The card reads "Cerrada · <reason>", the ticket leaves Te espera when nothing else is owed, nothing wakes.
 * `review open` at any head reopens the card.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const { reason } = await body(req, reviewCloseInput);
  return json({ review: r.reviews.close(id, reason) });
});
