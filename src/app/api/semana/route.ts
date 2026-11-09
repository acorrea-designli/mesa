import { loadSemana } from "@/features/semana/read";
import { weekQuery } from "@/lib/api/schemas";
import { json, query, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/** GET /api/semana?semana=YYYY-MM-DD&proyecto=<name> -> SemanaData (the week's done work by project, then kind) */
export const GET = route((req, r) => {
  const q = weekQuery.parse(Object.fromEntries(query(req)));
  return json(loadSemana(r, q));
});
