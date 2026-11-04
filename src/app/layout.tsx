import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { THEME_BOOT, ToastProvider } from "@/components/ui/interactive";
import { repos } from "@/lib/repo";
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

export const metadata: Metadata = {
  title: { default: "Mesa", template: "%s · Mesa" },
  description: "Lo que te espera hoy: PRs, Basecamp, Slack y Claude en una sola línea.",
};

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
  const counts = repos().counts();
  return (
    <html lang="es" className={hanken.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <ToastProvider>
          <AppShell counts={counts}>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
