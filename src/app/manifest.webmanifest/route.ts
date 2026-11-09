import type { MetadataRoute } from "next";

// Public (no mesa_token, see PUBLIC_PATHS in src/lib/access.ts): it holds no data. It is a route handler and not the
// app/manifest.ts convention on purpose: that convention emits <link rel="manifest"> WITHOUT crossorigin, so the
// browser fetches it with no cookies and Cloudflare Access would answer with a login redirect. src/app/layout.tsx emits
// the link itself with crossorigin="use-credentials", so the manifest request carries the CF_Authorization cookie.
// Colours are the Tokio light tokens (--gnd, src/styles/tokens.css); icons are drawn from the BrandMark (scripts/make-icons.mjs).
const manifest: MetadataRoute.Manifest = {
  name: "Mesa",
  short_name: "Mesa",
  description: "Lo que te espera hoy: PRs, Basecamp, Slack y Claude en una sola línea.",
  lang: "es",
  dir: "ltr",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#eceae5",
  theme_color: "#eceae5",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export function GET() {
  return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-cache" } });
}
