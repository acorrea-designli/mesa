// What a ticket needs from Andrés, derived from facts and never from tickets.status alone.
//
// The stored status drifts: a plan with needs_ok steps sets waiting_andres, but any later reply or claim
// moves it to waiting_claude / working while the steps stay "planned". Salidas, permission approvals and
// review cards never touched the status at all. So the list asks the facts. Pure: no IO, client safe.
import { stepsOwed } from "./ticket-checklists";
import { keysLine, openInOrder, recommendedLine } from "./ticket-questions";
import type { Approval, PlannedAction, Review, Salida, TicketMessage, TicketQuestion, TicketStatus, TicketStep } from "./types";

export type NeedKind = "permission" | "answer" | "steps" | "plan" | "review" | "salida";

export interface TicketNeed {
  kind: NeedKind;
  /** The action's name, exactly as Andrés reads it: "Aprobar plan". */
  label: string;
  /** What it is about, one short phrase: "2 pasos te piden OK". */
  detail: string;
}

/** Priority order: the first need of a ticket is the one the list names. */
export const NEED_ORDER: readonly NeedKind[] = ["permission", "answer", "steps", "plan", "review", "salida"];

export const NEED_LABEL: Record<NeedKind, string> = {
  permission: "Dar permiso",
  answer: "Responder",
  steps: "Hacer pasos",
  plan: "Aprobar plan",
  review: "Decidir review",
  salida: "Firmar salida",
};

export interface TicketNeedsInput {
  status: TicketStatus;
  messages: Pick<TicketMessage, "id" | "author" | "body">[];
  /** The ticket's card questions, any state: every open one counts. */
  questions: Pick<TicketQuestion, "messageId" | "n" | "options" | "recommended" | "state" | "createdAt">[];
  /** The steps of the ticket's checklists (t124), any state: every open one is something he owes. */
  steps: Pick<TicketStep, "state" | "messageId">[];
  actions: Pick<PlannedAction, "state" | "mode">[];
  /** The ticket's approvals, any status: only the pending ones that have not lapsed count. */
  approvals: Pick<Approval, "status" | "agent" | "expiresAt">[];
  reviews: (Pick<Review, "state"> & { findings: { state: string }[] })[];
  /** The ticket's salidas, any status: only "pending" ones count. */
  salidas: Pick<Salida, "status" | "title">[];
}

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The needs of one ticket, in priority order (permission, answer, steps, plan, review, salida). None when closed. */
export function ticketNeeds(t: TicketNeedsInput, now: Date = new Date()): TicketNeed[] {
  if (t.status === "closed") return [];
  const out = new Map<NeedKind, TicketNeed>();
  const add = (kind: NeedKind, detail: string) => out.set(kind, { kind, label: NEED_LABEL[kind], detail });

  const permissions = t.approvals.filter((a) => a.status === "pending" && Date.parse(a.expiresAt) > now.getTime());
  if (permissions.length) {
    const more = permissions.length - 1;
    add("permission", `${permissions[0]!.agent}${more ? ` y ${more} más` : ""}`);
  }

  const steps = t.actions.filter((a) => a.state === "planned" && a.mode === "needs_ok").length;
  if (steps) add("plan", `${steps} ${plural(steps, "paso te pide", "pasos te piden")} OK`);

  const openReviews = t.reviews.filter((r) => r.state === "open");
  if (t.status === "waiting_andres" && openReviews.length) {
    const findings = openReviews.reduce((n, r) => n + r.findings.filter((f) => f.state === "open").length, 0);
    add("review", findings ? `${findings} ${plural(findings, "abierto", "abiertos")}` : "lista para aprobar");
  }

  const salidas = t.salidas.filter((s) => s.status === "pending");
  if (salidas.length) {
    const more = salidas.length - 1;
    add("salida", `${salidas[0]!.title}${more ? ` y ${more} más` : ""}`);
  }

  // Hacer pasos: the open steps of a checklist ("2 de 5 hechos", over the checklists that still have one open).
  const owed = stepsOwed(t.steps);
  if (owed.open) add("steps", `${owed.done} de ${owed.total} hechos`);

  // Responder: every open card question counts ("3 preguntas abiertas · Claude recomienda 1A 2C 3B"); or the
  // status says it is his turn and neither the plan, a review nor a checklist explains it (a question without options, an --ask).
  const open = openInOrder(t.questions, t.messages);
  if (open.length) {
    const rec = recommendedLine(open);
    const parts = open.length === 1 ? [`elige ${keysLine(open[0]!.options)}`] : [`${open.length} preguntas abiertas`];
    if (rec) parts.push(`Claude recomienda ${rec}`);
    add("answer", parts.join(" · "));
  } else if (t.status === "waiting_andres" && !out.has("plan") && !out.has("review") && !out.has("steps")) {
    const last = [...t.messages].reverse().find((m) => m.author === "claude");
    add("answer", last?.body ? clip(last.body, 70) : "Claude espera tu respuesta");
  }

  return NEED_ORDER.flatMap((k) => out.get(k) ?? []);
}

/** The row line: the first need's label (shown bold) and the rest of the sentence. "Aprobar plan" + " · 2 pasos te piden OK · también Firmar salida". */
export function needLine(needs: TicketNeed[]): { lead: string; rest: string } | null {
  const first = needs[0];
  if (!first) return null;
  const also = needs.length > 1 ? ` · también ${needs.slice(1).map((n) => n.label).join(", ")}` : "";
  return { lead: first.label, rest: ` · ${first.detail}${also}` };
}

/** Rank of a ticket's first need, lower first; Infinity without needs. */
export const needRank = (needs: TicketNeed[]) => (needs[0] ? NEED_ORDER.indexOf(needs[0].kind) : Infinity);
