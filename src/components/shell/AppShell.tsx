import type { ReactNode } from "react";
import type { Counts } from "@/lib/domain/types";
import { getSourceHealth } from "@/lib/integrations/health";
import type { SourceHealth } from "./health";
import { PhoneTabs } from "./PhoneTabs";
import { Rail } from "./Rail";
import "./shell-a.css";

/**
 * Desktop: 184px rail + work area. Phone (<= 720px): the rail is replaced by the
 * bottom tab bar. Each screen lays out its own band, list and detail pane inside
 * <main class="work">.
 */
export function AppShell({ counts, health, children }: { counts: Counts; health?: (SourceHealth & { name: string })[]; children: ReactNode }) {
  return (
    <div className="app">
      <Rail counts={counts} health={health ?? getSourceHealth()} />
      <main className="work" id="main">
        {children}
      </main>
      <PhoneTabs counts={counts} />
    </div>
  );
}
