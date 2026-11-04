import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { THEME_BOOT, ToastProvider } from "@/components/ui/interactive";
import { isSandbox } from "@/lib/env";
import { repos } from "@/lib/repo";
import { readSandboxCopy } from "@/lib/sandbox/copy";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/components.css";
import "@/styles/shell.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  display: "swap",
});

const DESCRIPTION = "Lo que te espera hoy: PRs, Basecamp, Slack y Claude en una sola línea.";

// The sandbox board's tab title starts with "[sandbox]" on every page.
export function generateMetadata(): Metadata {
  const p = isSandbox() ? "[sandbox] " : "";
  return { title: { default: `${p}Mesa`, template: `${p}%s · Mesa` }, description: DESCRIPTION };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eceae5" },
    { media: "(prefers-color-scheme: dark)", color: "#17191d" },
  ],
};

// Every view reads live state from SQLite.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  const r = repos();
  const counts = r.counts();
  const sandbox = isSandbox() ? { copy: readSandboxCopy(r.db) } : undefined;
  return (
    <html lang="es" className={hanken.variable} data-env={sandbox ? "sandbox" : undefined} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <ToastProvider>
          <AppShell counts={counts} sandbox={sandbox}>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
