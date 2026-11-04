// Server read model for Salidas B: the queue with every detail the card needs,
// the ticket it came from and that ticket's history as a line of stations.
import type { Repos } from "@/lib/repo";
import type { SalidaDetail, SalidaStatus } from "@/lib/domain/types";
import { destinationUrl, type DestinationConfig } from "./model";
import type { HistoryEvent, SalidaView, SalidasData, TicketBrief } from "./types";

const OPEN: SalidaStatus[] = ["pending", "scheduled", "queued_until_back", "sending", "failed"];
const DECIDED: SalidaStatus[] = ["sent", "denied", "expired", "deleted"];

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

/** Slack domain and Basecamp account id for "Abrir destino": MESA_SLACK_DOMAIN and MESA_BASECAMP_ACCOUNT (.env.example). */
export function destinationConfig(env: Record<string, string | undefined> = process.env): DestinationConfig {
  return { slackDomain: env.MESA_SLACK_DOMAIN, basecampAccount: env.MESA_BASECAMP_ACCOUNT };
}

/** A salida detail with its destinationUrl: what GET /api/salidas/:id and the transition answer carry. */
export function withDestinationUrl<T extends SalidaDetail>(s: T, cfg: DestinationConfig = destinationConfig()): T & { destinationUrl: string | null } {
  return { ...s, destinationUrl: destinationUrl(s, cfg) };
}

export function salidaView(r: Repos, id: string, cfg: DestinationConfig = destinationConfig()): SalidaView {
  const s = withDestinationUrl(r.salidas.detail(id), cfg);
  return { ...s, ticket: ticketBrief(r, s.ticketId), history: s.ticketId ? ticketHistory(r, s.ticketId, s.id) : [] };
}

/** Open salidas plus today's decided ones (they stay in the strip, dashed). */
export function loadSalidas(r: Repos, now = new Date()): SalidasData {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const open = r.salidas.list({ status: OPEN });
  const decided = r.salidas.list({ status: DECIDED }).filter((s) => s.updatedAt >= day.toISOString());
  const items = [...open, ...decided].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((s) => salidaView(r, s.id));
  const down = r.sources.list().filter((x) => x.health === "down").map((x) => x.source);
  return { items, chips: r.chips.top(), sourcesDown: down, now: now.toISOString() };
}
