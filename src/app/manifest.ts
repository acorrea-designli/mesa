import type { MetadataRoute } from "next";

// Public (no token): a browser fetches the manifest without cookies, and it holds no data. Colours are the
// Tokio light tokens (--gnd, src/styles/tokens.css); icons are drawn from the BrandMark (scripts/make-icons.mjs).
export default function manifest(): MetadataRoute.Manifest {
  return {
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
}
