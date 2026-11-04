import { error, json, route } from "@/lib/api/http";
import { githubEnabled, githubWorker } from "@/lib/integrations/github-worker";

export const dynamic = "force-dynamic";

/**
 * POST /api/github/sync -> { ingest, project } runs a full pass now: notifications (still
 * conditional), review requests, Project find-or-create, push and pull. Shares a pass in
 * flight. Hoy's "Crear «Mesa»" and "Reintentar" call it. 409 when GitHub is off on this
 * server (a scratch MESA_DB without MESA_GITHUB=on), so test data never reaches GitHub.
 */
export const POST = route(async () => {
  if (!githubEnabled()) return error(409, "github_off", "GitHub sync is off on this server (set MESA_GITHUB=on)");
  return json(await githubWorker().run({ force: true }));
});
