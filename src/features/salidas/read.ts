// Server read model for Salidas B: the queue with every detail the card needs,
// the ticket it came from and that ticket's history as a line of stations.
import type { Repos } from "@/lib/repo";
import { fileState } from "@/lib/repo/salida-files";
import type { FileState } from "@/lib/domain/salida-files";
import { NotFoundError } from "@/lib/db/util";
import { dayStart, decodeCursor, encodeCursor } from "@/lib/domain/salida-queue";
import type { ConversationLinks, SalidaDetail, SalidaStatus } from "@/lib/domain/types";
import { conversationLinks, destinationUrl, type DestinationConfig } from "./model";
import type { HistoryEvent, HistoryPage, SalidaView, SalidasData, TicketBrief } from "./types";

const clip = (s: string, n = 120) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};

/** The ticket's story as stations: messages, plan, handoffs and the salidas it produced. */
export function ticketHistory(r: Repos, ticketId: string, salidaId?: string): HistoryEvent[] {
  const t = r.tickets.detail(ticketId);
  const ev: HistoryEvent[] = [];
  t.messages.forEach((m, i) => {
    const first = i === 0;
    const text =
      m.author === "andres"
        ? first
          ? `Pediste: ${clip(m.body || t.title, 80)}`
          : m.chosen
            ? `Elegiste ${m.chosen}${m.body ? `: ${clip(m.body, 70)}` : ""}`
            : `Respondiste: ${clip(m.body, 80)}`
        : first
          ? `Claude preguntó: ${clip(m.body || t.title, 80)}`
          : `Claude: ${clip(m.body, 90)}`;
    ev.push({ at: m.createdAt, source: "claude", text, link: `Ticket ${t.ref}`, href: `/tickets?t=${t.ref}`, evidence: m.body || undefined });
  });
  for (const a of t.actions) {
    ev.push({ at: a.createdAt, source: a.source, text: `Claude planeó: ${a.label}`, link: `Ticket ${t.ref}`, href: `/tickets?t=${t.ref}` });
  }
  for (const h of r.agents.handoffs({ ticket: t.id, limit: 50 })) {
    const pr = typeof h.artifacts.pr === "string" ? h.artifacts.pr : undefined;
    ev.push({
      at: h.createdAt,
      source: pr ? "github" : "claude",
      text: `${h.agent}: ${clip(h.body || h.done || h.status, 80)}`,
      link: pr ? pr.replace(/^https?:\/\/github\.com\//, "") : h.agent,
      href: pr && /^https?:/.test(pr) ? pr : undefined,
      evidence: [h.done && `Hecho: ${h.done}`, h.remaining && `Falta: ${h.remaining}`].filter(Boolean).join("\n") || undefined,
    });
  }
  for (const s of r.salidas.list().filter((x) => x.ticketId === t.id)) {
    ev.push({
      at: s.createdAt,
      source: "claude",
      text: s.id === salidaId ? "Claude redactó esta salida" : `Claude redactó: ${clip(s.title, 70)}`,
      link: "Salida",
      href: `/salidas?s=${s.id}`,
      now: s.id === salidaId,
    });
  }
  return ev.sort((a, b) => a.at.localeCompare(b.at) || Number(Boolean(a.now)) - Number(Boolean(b.now)));
}

export function ticketBrief(r: Repos, ticketId: string | null): TicketBrief | null {
  if (!ticketId) return null;
  try {
    const t = r.tickets.detail(ticketId);
    const links = t.engram;
    const last = links[links.length - 1];
    return { id: t.id, ref: t.ref, title: t.title, project: t.project, engramTopic: last?.topicKey ?? `mesa/${t.ref}`, engramAt: last?.createdAt ?? null, engramLinked: links.length > 0 };
  } catch {
    return null;
  }
}

/** Slack domain, Basecamp account id and Slack team id for "Abrir destino" and "Abrir conversación": MESA_SLACK_DOMAIN, MESA_BASECAMP_ACCOUNT and MESA_SLACK_TEAM_ID (.env.example). */
export function destinationConfig(env: Record<string, string | undefined> = process.env): DestinationConfig {
  return { slackDomain: env.MESA_SLACK_DOMAIN, basecampAccount: env.MESA_BASECAMP_ACCOUNT, slackTeamId: env.MESA_SLACK_TEAM_ID };
}

const FINAL: SalidaStatus[] = ["sent", "denied", "expired", "deleted", "withdrawn"];

/** t196: for each file the destination carries, whether it is still exactly the proposed one. Final salidas are not re-read (the file may be gone by then). */
function fileStates(s: SalidaDetail): FileState[] {
  const files = "files" in s.destination ? (s.destination.files ?? []) : [];
  if (!files.length || FINAL.includes(s.status)) return [];
  return files.map(fileState);
}

/** A salida detail with its destinationUrl, Slack conversation links and file states: every route under /api/salidas that answers with a SalidaDetail returns it through here. */
export function withDestinationUrl<T extends SalidaDetail>(s: T, cfg: DestinationConfig = destinationConfig()): T & { destinationUrl: string | null; conversation: ConversationLinks | null; fileStates: FileState[] } {
  return { ...s, destinationUrl: destinationUrl(s, cfg), conversation: conversationLinks(s, cfg), fileStates: fileStates(s) };
}

export function salidaView(r: Repos, id: string, cfg: DestinationConfig = destinationConfig()): SalidaView {
  const s = withDestinationUrl(r.salidas.detail(id), cfg);
  return { ...s, ticket: ticketBrief(r, s.ticketId), history: s.ticketId ? ticketHistory(r, s.ticketId, s.id) : [] };
}

/**
 * The queue strip, newest first (t204): every salida awaiting signature or in progress whatever its date, plus every
 * salida created or updated today (`inQueue`, src/lib/domain/salida-queue.ts); the rest is the Historial.
 * `focusId` is the `?s=` of the URL: when it is not in the strip its view comes back as `focus` (opened through the
 * Historial), or as `missing` when no such salida exists, so a link never falls back silently.
 */
export function loadSalidas(r: Repos, now = new Date(), focusId?: string): SalidasData {
  const items = r.salidas.queue(dayStart(now)).map((s) => salidaView(r, s.id));
  const down = r.sources.list().filter((x) => x.health === "down").map((x) => x.source);
  let focus: SalidaView | null = null;
  let missing: string | null = null;
  if (focusId && !items.some((s) => s.id === focusId)) {
    try {
      focus = salidaView(r, focusId);
    } catch (e) {
      // by name too: the page and the repo can be bundled as separate module instances, which defeats instanceof
      if (!(e instanceof NotFoundError || (e instanceof Error && e.name === "NotFoundError"))) throw e;
      missing = focusId;
    }
  }
  return { items, chips: r.chips.top(), sourcesDown: down, now: now.toISOString(), focus, missing };
}

/** One page of the Historial: row data only, no ticket history for rows nobody opens (`before`: the cursor of the previous page). */
export function loadHistory(r: Repos, f: { cursor?: string | null; limit?: number } = {}, now = new Date()): HistoryPage {
  const { rows, next } = r.salidas.history({ day: dayStart(now), limit: f.limit, cursor: decodeCursor(f.cursor) });
  return { rows, next: next ? encodeCursor(next) : null };
}
