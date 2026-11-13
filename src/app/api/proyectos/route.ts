import { z } from "zod";
import { error, json, query, route } from "@/lib/api/http";
import { loadProjectsPayload } from "@/lib/integrations/projects-view";
import { projectsReaderSpend } from "@/lib/integrations/projects-reader";

export const dynamic = "force-dynamic";

const proyectosQuery = z.object({ proyecto: z.string().regex(/^[a-z0-9-]+$/).optional() });

/**
 * GET /api/proyectos?proyecto=<key> -> { projects, openPrs, view, health, configError, spend } (t152). Read from the
 * SQLite cache only, never from GitHub: `view` is one project's view model (stations with counts, lines per repo,
 * issues, PRs; the first configured project without `proyecto`), `openPrs` the rail count across every project,
 * `health` the reader's Estados B row, `spend` the reader's REST requests and GraphQL points in the last hour (null
 * when it is not running). 404 for an unknown project.
 */
export const GET = route((req, r) => {
  const q = proyectosQuery.parse(Object.fromEntries(query(req)));
  const payload = loadProjectsPayload(r, q.proyecto ?? null);
  if (q.proyecto && !payload.view) return error(404, "not_found", `proyecto ${q.proyecto} not found`);
  return json({ ...payload, spend: projectsReaderSpend() });
});
