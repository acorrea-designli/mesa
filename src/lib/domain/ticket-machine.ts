// Ticket state machine. Pure: no IO.
//
// One stream, two directions. The status says whose turn it is:
//   waiting_andres  Claude asked, or posted a plan that needs his OK   ("Te espera")
//   waiting_claude  Andrés asked or answered; the owner session wakes  ("Espera a Claude")
//   working         Claude took it and is doing the work                ("Claude trabaja")
//   closed          done                                                ("Cerrado" · Reabrir)

import type { TicketDirection, TicketStatus, WakeKind } from "./types";

export type TicketEvent =
  | { type: "andres_reply" } // Andrés answers or adds to the ticket (wakes the owner)
  | { type: "claude_reply"; asks?: boolean } // Claude answers back; asks = it has options or is flagged as a question
  | { type: "claude_plan"; needsOk: boolean } // Claude posts "Claude va a hacer"
  | { type: "approve_plan" } // Andrés OKs the plan (wakes the owner)
  | { type: "permission_request" } // "Pídeme permiso": the agent must file an approval card (wakes the owner)
  | { type: "claim" } // a session takes the ticket and starts work
  | { type: "close"; by: "andres" | "claude" }
  | { type: "reopen"; by?: "andres" | "claude" }; // by defaults to Andrés (the UI); Claude's reopen is not his interaction

export type TicketEventType = TicketEvent["type"];

export type TicketTransition =
  | { ok: true; status: TicketStatus; wake?: WakeKind }
  | { ok: false; error: string };

export function initialTicketStatus(direction: TicketDirection): TicketStatus {
  return direction === "claude_asks" ? "waiting_andres" : "waiting_claude";
}

const fail = (error: string): TicketTransition => ({ ok: false, error });

export function transitionTicket(status: TicketStatus, ev: TicketEvent): TicketTransition {
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
      if (status !== "waiting_andres") return fail("there is no plan waiting for approval");
      return { ok: true, status: "working", wake: "ticket.plan_approved" };

    case "permission_request":
      // Andrés asked for a card, not for an answer: it hands the turn to Claude and never changes anything else.
      return { ok: true, status: status === "waiting_andres" ? "waiting_claude" : status, wake: "ticket.permission_requested" };

    case "claim":
      if (status !== "waiting_claude") return fail(`cannot claim a ticket that is ${status}`);
      return { ok: true, status: "working" };

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
  closed: "Cerrado",
};
