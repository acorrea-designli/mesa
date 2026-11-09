// The triage hint a ticket.created wake (and a ticket.batch entry) carries. Pure: no IO.
import type { DispatchKind, Item } from "./types";

/** A GitHub PR is a review; otherwise the lead decides. */
export function inferKind(items: Pick<Item, "source" | "url">[]): DispatchKind | undefined {
  return items.some((i) => i.source === "github" && /\/pull\/\d+/.test(i.url ?? "")) ? "review" : undefined;
}
