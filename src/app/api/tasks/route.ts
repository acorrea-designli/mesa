import { body, json, query, route } from "@/lib/api/http";
import { source, station, taskInput } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/tasks?station=&source= -> Task[] (with linked items) */
export const GET = route((req, r) => {
  const q = query(req);
  return json(
    r.tasks.list({
      station: q.get("station") ? station.parse(q.get("station")) : undefined,
      source: q.get("source") ? source.parse(q.get("source")) : undefined,
    }),
  );
});

/**
 * POST /api/tasks TaskInput & { noteOnly?, kind? } -> Task & { ticket: { id, ref } | null } (201)
 * Without noteOnly the card is handed to Claude (linked ticket + ticket.created to the lead),
 * except cards made from ingested items (itemIds) and samples, which are only noted.
 */
export const POST = route(async (req, r) => {
  const { task, ticket } = r.dispatch.createTask(await body(req, taskInput));
  return json({ ...task, ticket }, { status: 201 });
});
