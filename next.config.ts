import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep the mockups and their vendored scripts out of the build graph.
  outputFileTracingExcludes: { "*": [".impeccable/**", "data/**"] },
};

export default config;
