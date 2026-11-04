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

/** POST /api/tasks TaskInput -> Task (201) */
export const POST = route(async (req, r) => json(r.tasks.create(await body(req, taskInput)), { status: 201 }));
