import type { ReactNode } from "react";
import type { Counts } from "@/lib/domain/types";
import { PhoneTabs } from "./PhoneTabs";
import { Rail, type SourceHealth } from "./Rail";

/**
 * Desktop: 184px rail + work area. Phone (<= 720px): the rail is replaced by the
 * bottom tab bar. Each screen lays out its own band, list and detail pane inside
 * <main class="work">.
 */
export function AppShell({ counts, health, children }: { counts: Counts; health?: SourceHealth[]; children: ReactNode }) {
  return (
    <div className="app">
      <Rail counts={counts} health={health} />
      <main className="work" id="main">
        {children}
      </main>
      <PhoneTabs counts={counts} />
    </div>
  );
}
