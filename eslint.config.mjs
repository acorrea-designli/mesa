import next from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...next,
  ...nextTs,
  {
    ignores: [".next/**", ".next-sandbox/**", "node_modules/**", ".impeccable/**", "data/**", "next-env.d.ts", "coverage/**"],
  },
];

export default config;
