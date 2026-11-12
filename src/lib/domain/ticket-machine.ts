// Ticket state machine. Pure: no IO.
//
// One stream, two directions. The status says whose turn it is:
//   waiting_andres  Claude asked, or posted a plan that needs his OK   ("Te espera")
//   waiting_claude  Andrés asked or answered; the owner session wakes  ("Espera a Claude")
//   working         Claude took it and is doing the work                ("Claude trabaja")
//   paused          blocked on something else, with a reason and maybe a ticket ("En pausa", t126)
//   ongoing         going on with nobody active right now: CI, a third party ("En proceso", t126)
//   closed          done                                                ("Cerrado" · Reabrir)
// paused/ongoing are open states that read neither "Te espera" nor "Claude trabaja". They end on an explicit resume,
// Andrés's reply, Claude asking or planning, a claim or a close; an informational Claude reply leaves them as they are.
// A press of Andrés on the ticket's review, salida or permission card is his turn taken (`andres_acted`).

import type { TicketDirection, TicketStatus, WakeKind } from "./types";

export type TicketEvent =
  | { type: "andres_reply" } // Andrés answers or adds to the ticket (wakes the owner)
  | { type: "claude_reply"; asks?: boolean } // Claude answers back; asks = it has options or is flagged as a question
  | { type: "claude_plan"; needsOk: boolean } // Claude posts "Claude va a hacer"
  | { type: "approve_plan"; planned: boolean } // Andrés OKs the plan (wakes the owner); planned = some action is still "planned"
  | { type: "permission_request" } // "Pídeme permiso": the agent must file an approval card (wakes the owner)
  | { type: "andres_acted" } // Andrés pressed a button on the ticket (review action, salida, permission): his turn is taken
  | { type: "claim" } // a session takes the ticket and starts work
  | { type: "pause"; kind: PauseKind } // blocked on something else (paused) or going on with nobody active (ongoing)
  | { type: "resume"; by: ResumeBy } // paused/ongoing ends: Claude -> working (no wake); Andrés or the dependency closing -> waiting_claude + ticket.resumed
  | { type: "close"; by: "andres" | "claude" }
  | { type: "reopen"; by?: "andres" | "claude" }; // by defaults to Andrés (the UI); Claude's reopen is not his interaction

export type PauseKind = "paused" | "ongoing";
export type ResumeBy = "claude" | "andres" | "dependency";

export const isPauseStatus = (s: TicketStatus): s is PauseKind => s === "paused" || s === "ongoing";

export type TicketEventType = TicketEvent["type"];

export type TicketTransition =
  | { ok: true; status: TicketStatus; wake?: WakeKind }
  | { ok: false; error: string };

export function initialTicketStatus(direction: TicketDirection): TicketStatus {
  return direction === "claude_asks" ? "waiting_andres" : "waiting_claude";
}

const fail = (error: string): TicketTransition => ({ ok: false, error });

export function transitionTicket(status: TicketStatus, ev: TicketEvent): TicketTransition {
  // A press is his turn taken: Te espera becomes Espera a Claude. Anything else stays as it is (a closed ticket
  // included, never an error) and it never wakes: the press's own wake already reached the owner.
  if (ev.type === "andres_acted") return { ok: true, status: status === "waiting_andres" ? "waiting_claude" : status };

  if (status === "closed" && ev.type !== "reopen") return fail("ticket is closed; reopen it first");

  switch (ev.type) {
    case "andres_reply":
      return { ok: true, status: "waiting_claude", wake: "ticket.answered" };

    case "claude_reply":
      // Only a question (options or --ask) is Andrés's turn. An informational reply leaves a pending
      // plan or question where it is and turns a request nobody has claimed yet into work in progress.
      if (ev.asks) return { ok: true, status: "waiting_andres" };
      return { ok: true, status: status === "waiting_claude" ? "working" : status };

    case "claude_plan":
      return { ok: true, status: ev.needsOk ? "waiting_andres" : "working" };

    case "approve_plan":
      // The fact that matters is a planned step, not the status: a reply or a claim moves the status off
      // waiting_andres while the needs_ok steps stay planned (src/lib/domain/ticket-needs.ts).
      if (!ev.planned) return fail("there is no plan waiting for approval");
      return { ok: true, status: "working", wake: "ticket.plan_approved" };

    case "permission_request":
      // Andrés asked for a card, not for an answer: it hands the turn to Claude and never changes anything else.
      return { ok: true, status: status === "waiting_andres" ? "waiting_claude" : status, wake: "ticket.permission_requested" };

    case "claim":
      // A paused/ongoing ticket can be claimed too: the owner picks the work up again.
      if (status !== "waiting_claude" && !isPauseStatus(status)) return fail(`cannot claim a ticket that is ${status}`);
      return { ok: true, status: "working" };

    case "pause":
      // From any open status (the closed check above); paused <-> ongoing is a plain switch.
      return { ok: true, status: ev.kind };

    case "resume":
      if (!isPauseStatus(status)) return fail("ticket is not paused or ongoing");
      // Claude resuming goes straight back to work; Andrés or the dependency closing hands it to Claude (the owner wakes).
      if (ev.by === "claude") return { ok: true, status: "working" };
      return { ok: true, status: "waiting_claude", wake: "ticket.resumed" };

    case "close":
      // Closing by Andrés wakes the owner so it can stop; Claude closing needs no wake.
      return { ok: true, status: "closed", wake: ev.by === "andres" ? "ticket.closed" : undefined };

    case "reopen":
      if (status !== "closed") return fail("ticket is not closed");
      return { ok: true, status: "waiting_claude", wake: "ticket.reopened" };
  }
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  waiting_andres: "Te espera",
  waiting_claude: "Espera a Claude",
  working: "Claude trabaja",
  paused: "En pausa",
  ongoing: "En proceso",
  closed: "Cerrado",
};
