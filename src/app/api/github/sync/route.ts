import { error, json, route } from "@/lib/api/http";
import { isSandbox, SANDBOX_REFUSAL } from "@/lib/env";
import { githubEnabled, githubNoToken, githubWorker } from "@/lib/integrations/github-worker";

export const dynamic = "force-dynamic";

/**
 * POST /api/github/sync -> { ingest, project } runs a full pass now: notifications (still
 * conditional), review requests, Project find-or-create, push and pull. Shares a pass in
 * flight. Hoy's "Crear «Mesa»" and "Reintentar" call it. 409 when GitHub is off on this
 * server (a scratch MESA_DB without MESA_GITHUB=on), so test data never reaches GitHub, and
 * 409 `sandbox` on the sandbox board (MESA_ENV=sandbox), where GitHub is always off.
 */
export const POST = route(async () => {
  if (isSandbox()) return error(409, "sandbox", SANDBOX_REFUSAL);
  if (githubNoToken()) return error(409, "github_off", "GitHub sync is off on this server: gh has no token for the configured login (MESA_GH_USER)");
  if (!githubEnabled()) return error(409, "github_off", "GitHub sync is off on this server (set MESA_GITHUB=on)");
  return json(await githubWorker().run({ force: true }));
});
