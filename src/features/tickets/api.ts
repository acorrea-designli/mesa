// Client calls for Tickets A.
import type { TicketDetail } from "@/lib/domain/types";
import { call } from "@/features/salidas/api";
import type { ComposerState } from "./Composer";

const T = (id: string) => `/api/tickets/${encodeURIComponent(id)}`;

async function upload(ticketId: string, files: File[], messageId?: string) {
  for (const f of files) {
    const form = new FormData();
    form.set("file", f);
    if (messageId) form.set("messageId", messageId);
    await call(`${T(ticketId)}/attachments`, { form });
  }
}

const refsOf = (s: ComposerState, extra: { refType: "url" | "ticket" | "item"; target: string; label?: string }[] = []) => [
  ...s.refs.map((r) => ({ refType: "ticket" as const, target: r.target, label: r.label })),
  ...extra,
];

export const ticketApi = {
  /** Andrés answers (wakes the owner with ticket.answered). Files attach to the new message. */
  async reply(id: string, s: ComposerState, chosen?: string): Promise<TicketDetail> {
    const body = s.text.trim();
    const d = await call<TicketDetail>(`${T(id)}/messages`, { body: { author: "andres", body: body || undefined, chosen, refs: refsOf(s) } });
    const msg = [...d.messages].reverse().find((m) => m.author === "andres");
    if (s.files.length) await upload(d.id, s.files, msg?.id);
    return d;
  },
  async create(input: { text: string; project: string; link?: string; owner?: string; state: ComposerState }): Promise<TicketDetail> {
    const text = input.text.trim();
    const first = text.split("\n").find((l) => l.trim()) ?? text;
    const title = first.length > 90 ? first.slice(0, 89) + "…" : first;
    const extra = input.link?.trim() ? [{ refType: "url" as const, target: input.link.trim(), label: input.link.trim() }] : [];
    const d = await call<TicketDetail>("/api/tickets", {
      body: { direction: "andres_asks", title, body: text, project: input.project || undefined, ownerSession: input.owner, refs: refsOf(input.state, extra) },
    });
    if (input.state.files.length) await upload(d.id, input.state.files, d.messages[0]?.id);
    return d;
  },
  /** Nuevo pedido with "Solo anotar (sin agente)": only a card on the Claude lane, no ticket. */
  note(input: { text: string; project: string; link?: string }) {
    const lines = input.text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const first = lines[0] ?? input.text.trim();
    const title = first.length > 90 ? first.slice(0, 89) + "…" : first;
    const excerpt = [lines.slice(1).join(" "), input.link?.trim()].filter(Boolean).join(" · ");
    return call<{ id: string }>("/api/tasks", { body: { title, source: "claude", excerpt: excerpt || undefined, project: input.project || undefined, noteOnly: true } });
  },
  close: (id: string) => call<TicketDetail>(`${T(id)}/transition`, { body: { event: "close", by: "andres" } }),
  reopen: (id: string) => call<TicketDetail>(`${T(id)}/transition`, { body: { event: "reopen", by: "andres" } }),
  approvePlan: (id: string, reject: string[]) => call<TicketDetail>(`${T(id)}/plan/approve`, { body: { reject } }),
};
