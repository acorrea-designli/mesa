// Tablero read model (server only).
import { repos } from "@/lib/repo";
import type { Item } from "@/lib/domain/types";
import { ago, clock, isToday, when } from "../hoy/format";
import { syncSummary, toCard, type Card, type SyncSummary } from "./model";

export interface TableroData {
  cards: Card[];
  sync: SyncSummary & { lastOkLabel: string | null; agoLabel: string | null };
  projectUrl: string;
  projectLabel: string;
  hasSample: boolean;
}

const OWNER = "acorrea-designli";

function setting(key: string): string | null {
  const row = repos().db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function loadTablero(now: Date = new Date()): TableroData {
  const r = repos();
  // Done cards stay on the board for the day they were finished.
  const tasks = r.tasks.list().filter((t) => t.station !== "done" || isToday(t.updatedAt, now));
  const byTask = new Map<string, Item[]>();
  for (const i of r.items.list()) if (i.taskId) byTask.set(i.taskId, [...(byTask.get(i.taskId) ?? []), i]);

  const cards = tasks.map((t) => {
    const linked = (byTask.get(t.id) ?? []).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    return toCard(t, when(linked[0]?.receivedAt ?? t.createdAt, now), linked);
  });
  const s = syncSummary(tasks);
  const number = setting("gh_project.number");
  return {
    cards,
    sync: { ...s, lastOkLabel: s.lastOkAt ? clock(s.lastOkAt) : null, agoLabel: s.lastOkAt ? ago(s.lastOkAt, now) : null },
    projectUrl: number ? `https://github.com/users/${OWNER}/projects/${number}` : `https://github.com/${OWNER}?tab=projects`,
    projectLabel: `${OWNER} / Mesa`,
    hasSample: tasks.some((t) => t.isSample),
  };
}
