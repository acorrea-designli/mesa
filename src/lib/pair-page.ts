// The small Spanish HTML pages of the pairing flow (no React, no cookies, no board data): the "type your code" form a
// phone sees when it has no mesa_token yet, and the result pages of /pair. Plain HTML because the proxy (src/proxy.ts)
// has to produce it too, before any app code runs.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export interface PairPageOptions {
  status: number;
  title: string;
  text: string;
  /** Show the code field (POST /pair). */
  form?: boolean;
  /** An error line above the field. */
  error?: string;
}

export function pairPage({ status, title, text, form = false, error }: PairPageOptions): Response {
  const field = form
    ? `<form method="post" action="/pair" style="margin:20px 0 0;display:flex;flex-direction:column;gap:12px;max-width:320px">` +
      (error ? `<p role="alert" style="margin:0;color:#a3241d;font-weight:600">${esc(error)}</p>` : "") +
      `<label for="code" style="font-weight:600">Código de 8 caracteres</label>` +
      `<input id="code" name="code" type="text" inputmode="text" autocomplete="one-time-code" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="16" required autofocus ` +
      `style="font:600 22px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;padding:12px;border:1.5px solid #1c1d21;border-radius:10px;background:#fff;color:#1c1d21">` +
      `<button type="submit" style="font:600 16px system-ui,sans-serif;padding:12px;border:0;border-radius:10px;background:#1c1d21;color:#eceae5">Vincular</button>` +
      `</form>`
    : "";
  const html =
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Mesa</title>` +
    `<body style="font:16px/1.5 system-ui,sans-serif;background:#eceae5;color:#1c1d21;margin:0;padding:32px 24px">` +
    `<h1 style="font-size:21px;margin:0 0 8px">${esc(title)}</h1><p style="margin:0;color:#3e4047">${esc(text)}</p>${field}</body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-mesa-guard": "1" } });
}

/** A browser navigation (a page load), as opposed to a fetch/XHR or an asset request. */
export function isNavigation(headers: { get(name: string): string | null }): boolean {
  const mode = headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return (headers.get("accept") ?? "").includes("text/html");
}

/** The page a navigation gets on a 401 (Access passed, the phone has no mesa_token yet). */
export const unpairedPage = () =>
  pairPage({
    status: 401,
    title: "Vincula este teléfono",
    text: "En tu PC abre Mesa, Teléfono, y escribe aquí el código que aparece junto al QR. Vale 10 minutos y una sola vez.",
    form: true,
  });
