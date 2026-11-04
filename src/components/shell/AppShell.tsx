import type { ReactNode } from "react";
import type { Counts } from "@/lib/domain/types";
import { getSourceHealth } from "@/lib/integrations/health";
import type { SourceHealth } from "./health";
import { PhoneTabs } from "./PhoneTabs";
import { Rail } from "./Rail";
import { SandboxBand } from "./SandboxBand";
import type { SandboxCopy } from "@/lib/sandbox/copy";
import "./shell-a.css";

/**
 * Desktop: 184px rail + work area. Phone (<= 720px): the rail is replaced by the
 * bottom tab bar. Each screen lays out its own band, list and detail pane inside
 * <main class="work">. On the sandbox board (`sandbox` set) the SANDBOX band frames everything.
 */
export function AppShell({
  counts,
  health,
  sandbox,
  children,
}: {
  counts: Counts;
  health?: (SourceHealth & { name: string })[];
  /** MESA_ENV=sandbox: where the dummy data came from (null when unknown). */
  sandbox?: { copy: SandboxCopy | null };
  children: ReactNode;
}) {
  return (
    <div className="app">
      {sandbox ? <SandboxBand copy={sandbox.copy} /> : null}
      <Rail counts={counts} health={health ?? getSourceHealth()} />
      <main className="work" id="main">
        {children}
      </main>
      <PhoneTabs counts={counts} />
    </div>
  );
}
