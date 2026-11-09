// Pure helpers for `pnpm tunnel` (scripts/tunnel.mjs): read `tailscale serve status --json`, decide whether Mesa is
// published and whether Funnel (the public internet) is on. Funnel must never be on: it would expose Mesa to anyone.

export const MESA_TARGET = "http://127.0.0.1:8790";
export const SERVE_ARGS = ["serve", "--bg", "--https=443", MESA_TARGET];
export const SERVE_OFF_ARGS = ["serve", "--https=443", "off"];

/**
 * ServeConfig JSON (what `tailscale serve status --json` prints; `{}` when nothing is served) ->
 * { serving: [{ host, path, target }], funnel: boolean, funnelHosts: string[], mesa: boolean, error?: string }
 */
export function analyzeServe(text) {
  let cfg;
  try {
    cfg = text.trim() ? JSON.parse(text) : {};
  } catch {
    return { serving: [], funnel: false, funnelHosts: [], mesa: false, error: "unreadable serve status" };
  }
  const serving = [];
  for (const [host, web] of Object.entries(cfg?.Web ?? {})) {
    for (const [path, h] of Object.entries(web?.Handlers ?? {})) {
      serving.push({ host, path, target: h?.Proxy ?? h?.Path ?? h?.Text ?? "" });
    }
  }
  const funnelHosts = Object.entries(cfg?.AllowFunnel ?? {})
    .filter(([, on]) => on === true)
    .map(([h]) => h);
  const mesa = serving.some((s) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):8790\/?$/.test(s.target));
  return { serving, funnel: funnelHosts.length > 0, funnelHosts, mesa };
}

/** Exit code of `pnpm tunnel status`: 0 serving Mesa with Funnel off, 1 not ready, 3 Funnel is ON (refuse). */
export function statusExitCode(s) {
  if (s.funnel) return 3;
  return s.installed && s.running && s.mesa ? 0 : 1;
}

/** One human line per fact, Spanish for the people who read it (Andrés), no secrets. */
export function describe(s) {
  const out = [];
  if (!s.installed) return ["Tailscale no está instalado en esta PC."];
  out.push(s.running ? `Tailscale activo${s.url ? ` · ${s.url}` : ""}` : "Tailscale instalado pero no conectado (inicia sesión).");
  out.push(s.mesa ? `Mesa publicada en el túnel (${MESA_TARGET})` : "Mesa NO está publicada: `pnpm tunnel up`");
  out.push(s.funnel ? `FUNNEL ENCENDIDO (${s.funnelHosts.join(", ")}): Mesa estaría en internet. Apágalo: tailscale funnel --https=443 off` : "Funnel apagado (solo tus dispositivos)");
  return out;
}
