// Uso (t60): the Claude plan windows (% remaining, pace, % over time) and the tokens spent (who, which model, which day).
import type { Metadata } from "next";
import { UsoView } from "@/features/usage/UsoView";
import { usageView } from "@/lib/domain/usage";
import { tokenSummary } from "@/lib/integrations/transcripts";
import { repos } from "@/lib/repo";

export const metadata: Metadata = { title: "Uso" };
export const dynamic = "force-dynamic";

export default function UsoPage() {
  const r = repos();
  const now = new Date();
  return <UsoView initial={{ now: now.toISOString(), view: usageView(r.usage.snapshot(), now), tokens: tokenSummary(r.db, now), history: r.usage.history() }} />;
}
