import type { ReactNode } from "react";
import type { Counts } from "@/lib/domain/types";
import { repos } from "@/lib/repo";
import { railHealth, type SourceHealth } from "./health";
import { PhoneTabs } from "./PhoneTabs";
import { Rail } from "./Rail";
import "./shell-a.css";

/** Health rows for the rail notice (Estados B), read from source_state and the lead session. */
function loadHealth(): (SourceHealth & { name: string })[] {
  const r = repos();
  const now = new Date();
  const listening = r.sessions.list().some((s) => r.sessions.isListening(s, now));
  return railHealth(r.sources.list(), listening);
}

/**
 * Desktop: 184px rail + work area. Phone (<= 720px): the rail is replaced by the
 * bottom tab bar. Each screen lays out its own band, list and detail pane inside
 * <main class="work">.
 */
export function AppShell({ counts, health, children }: { counts: Counts; health?: (SourceHealth & { name: string })[]; children: ReactNode }) {
  return (
    <div className="app">
      <Rail counts={counts} health={health ?? loadHealth()} />
      <main className="work" id="main">
        {children}
      </main>
      <PhoneTabs counts={counts} />
    </div>
  );
}
