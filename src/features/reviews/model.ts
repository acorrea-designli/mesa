import type { Finding, Review } from "@/lib/domain/types";

/** Only an open review takes Andrés's buttons (Approve, Post, Dismiss, Explain more); a closed card has none, and every press would be a 409. */
export const takesActions = (r: Pick<Review, "state">) => r.state === "open";

/** A finding that can be picked or posted: open, not yet written to GitHub, on a review that takes actions. */
export const postable = (r: Pick<Review, "state">, f: Pick<Finding, "state" | "salidaId" | "ghCommentId">) =>
  takesActions(r) && f.state === "open" && !f.salidaId && !f.ghCommentId;
