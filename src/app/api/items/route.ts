import { body, json, query, route } from "@/lib/api/http";
import { itemInput, source, station } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/**
 * GET /api/items?station=&source=&open=you -> Item[]
 * `open=you` is what Hoy counts as Andrés's (not done, waiting on him) without samples and without ignored
 * projects: the notifier's feed.
 */
export const GET = route((req, r) => {
  const q = query(req);
  const open = q.get("open") === "you";
  return json(
    r.items.list({
      station: q.get("station") ? station.parse(q.get("station")) : undefined,
      source: q.get("source") ? source.parse(q.get("source")) : undefined,
      ...(open ? { open: "you" as const, includeSamples: false, ignored: "exclude" as const } : {}),
    }),
  );
});

/** POST /api/items ItemInput -> Item (201) */
export const POST = route(async (req, r) => json(r.items.create(await body(req, itemInput)), { status: 201 }));
