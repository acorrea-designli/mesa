import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // `pnpm sandbox` builds into .next-sandbox so it runs next to the live `next dev`, whose lock is in .next.
  distDir: process.env.MESA_DIST_DIR || ".next",
  poweredByHeader: false,
  // Next 16 blocks dev resources (HMR) from any origin but localhost, which leaves the page unhydrated when
  // Mesa is opened as 127.0.0.1 or from the phone on the LAN. Allow the hosts Mesa is actually served on.
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.*.*", "10.*.*.*", "*.trycloudflare.com", "*.ts.net"],
  // Keep the mockups and their vendored scripts out of the build graph.
  outputFileTracingExcludes: { "*": [".impeccable/**", "data/**"] },
};

export default config;
