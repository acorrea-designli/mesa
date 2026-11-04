import { body, json, route } from "@/lib/api/http";
import { reviewActionInput } from "@/lib/api/schemas";

/**
 * POST /api/reviews/:id/actions { action: approve|approve_anyway|post|dismiss|explain, findingNs?, note? }
 * -> { review, salidaIds }. GitHub writes become approved github salidas (20 s undo); wakes review.action
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const { salidaIds, ...review } = r.reviews.action(id, await body(req, reviewActionInput));
  return json({ review, salidaIds });
});
