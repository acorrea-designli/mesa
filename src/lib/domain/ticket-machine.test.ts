import { describe, expect, it } from "vitest";
import { initialTicketStatus, TICKET_STATUS_LABEL, transitionTicket } from "./ticket-machine";

describe("ticket machine", () => {
  it("starts on whoever must act", () => {
    expect(initialTicketStatus("claude_asks")).toBe("waiting_andres");
    expect(initialTicketStatus("andres_asks")).toBe("waiting_claude");
  });

  it("an answer from Andrés wakes the owner", () => {
    expect(transitionTicket("waiting_andres", { type: "andres_reply" })).toEqual({
      ok: true,
      status: "waiting_claude",
      wake: "ticket.answered",
    });
  });

  it("Claude asking (options or --ask) puts it back on Andrés", () => {
    expect(transitionTicket("working", { type: "claude_reply", asks: true })).toEqual({ ok: true, status: "waiting_andres" });
    expect(transitionTicket("waiting_claude", { type: "claude_reply", asks: true })).toMatchObject({ status: "waiting_andres" });
  });

  it("an informational reply never puts the ticket in Te espera", () => {
    expect(transitionTicket("working", { type: "claude_reply" })).toEqual({ ok: true, status: "working" });
    // a pending plan or question stays pending
    expect(transitionTicket("waiting_andres", { type: "claude_reply" })).toEqual({ ok: true, status: "waiting_andres" });
    // a request nobody had claimed yet is now being worked
    expect(transitionTicket("waiting_claude", { type: "claude_reply" })).toEqual({ ok: true, status: "working" });
    expect(transitionTicket("closed", { type: "claude_reply" }).ok).toBe(false);
  });

  it("a plan with a needs_ok action waits for Andrés; a direct-only plan runs", () => {
    expect(transitionTicket("waiting_claude", { type: "claude_plan", needsOk: true })).toMatchObject({ status: "waiting_andres" });
    expect(transitionTicket("waiting_claude", { type: "claude_plan", needsOk: false })).toMatchObject({ status: "working" });
  });

  it("a press of Andrés hands Te espera to Claude and changes nothing else, closed included, without a wake", () => {
    expect(transitionTicket("waiting_andres", { type: "andres_acted" })).toEqual({ ok: true, status: "waiting_claude" });
    for (const status of ["waiting_claude", "working", "closed"] as const) {
      expect(transitionTicket(status, { type: "andres_acted" })).toEqual({ ok: true, status });
    }
  });

  it("approving a plan needs a planned step, whatever the status", () => {
    const ok = { ok: true, status: "working", wake: "ticket.plan_approved" };
    for (const status of ["waiting_andres", "waiting_claude", "working"] as const) {
      expect(transitionTicket(status, { type: "approve_plan", planned: true })).toEqual(ok);
      expect(transitionTicket(status, { type: "approve_plan", planned: false }).ok).toBe(false);
    }
    expect(transitionTicket("closed", { type: "approve_plan", planned: true }).ok).toBe(false);
  });

  it("claim only from waiting_claude", () => {
    expect(transitionTicket("waiting_claude", { type: "claim" })).toMatchObject({ ok: true, status: "working" });
    expect(transitionTicket("waiting_andres", { type: "claim" }).ok).toBe(false);
  });

  it("closed tickets only reopen", () => {
    expect(transitionTicket("closed", { type: "andres_reply" }).ok).toBe(false);
    expect(transitionTicket("closed", { type: "reopen" })).toEqual({ ok: true, status: "waiting_claude", wake: "ticket.reopened" });
    expect(transitionTicket("working", { type: "reopen" }).ok).toBe(false);
  });

  it("closing by Andrés wakes; by Claude does not", () => {
    expect(transitionTicket("working", { type: "close", by: "andres" })).toMatchObject({ wake: "ticket.closed" });
    expect(transitionTicket("working", { type: "close", by: "claude" })).toEqual({ ok: true, status: "closed", wake: undefined });
  });

  describe("paused and ongoing (t126)", () => {
    const open = ["waiting_andres", "waiting_claude", "working", "paused", "ongoing"] as const;

    it("any open status can be paused or put on ongoing, with no wake; a closed ticket cannot", () => {
      for (const s of open) {
        expect(transitionTicket(s, { type: "pause", kind: "paused" })).toEqual({ ok: true, status: "paused" });
        expect(transitionTicket(s, { type: "pause", kind: "ongoing" })).toEqual({ ok: true, status: "ongoing" });
      }
      expect(transitionTicket("closed", { type: "pause", kind: "paused" }).ok).toBe(false);
      expect(transitionTicket("closed", { type: "pause", kind: "ongoing" }).ok).toBe(false);
    });

    it("resume by Claude goes to working without a wake; by Andrés or the dependency goes to waiting_claude and wakes", () => {
      for (const s of ["paused", "ongoing"] as const) {
        expect(transitionTicket(s, { type: "resume", by: "claude" })).toEqual({ ok: true, status: "working" });
        expect(transitionTicket(s, { type: "resume", by: "andres" })).toEqual({ ok: true, status: "waiting_claude", wake: "ticket.resumed" });
        expect(transitionTicket(s, { type: "resume", by: "dependency" })).toEqual({ ok: true, status: "waiting_claude", wake: "ticket.resumed" });
      }
    });

    it("resume needs a paused or ongoing ticket", () => {
      for (const s of ["waiting_andres", "waiting_claude", "working", "closed"] as const) {
        expect(transitionTicket(s, { type: "resume", by: "claude" }).ok).toBe(false);
      }
    });

    it("an informational Claude reply stays paused or ongoing; asking leaves", () => {
      for (const s of ["paused", "ongoing"] as const) {
        expect(transitionTicket(s, { type: "claude_reply" })).toEqual({ ok: true, status: s });
        expect(transitionTicket(s, { type: "claude_reply", asks: true })).toEqual({ ok: true, status: "waiting_andres" });
      }
    });

    it("Andrés replying, a plan, an approval, a claim and a close leave paused or ongoing", () => {
      for (const s of ["paused", "ongoing"] as const) {
        expect(transitionTicket(s, { type: "andres_reply" })).toEqual({ ok: true, status: "waiting_claude", wake: "ticket.answered" });
        expect(transitionTicket(s, { type: "claude_plan", needsOk: true })).toEqual({ ok: true, status: "waiting_andres" });
        expect(transitionTicket(s, { type: "claude_plan", needsOk: false })).toEqual({ ok: true, status: "working" });
        expect(transitionTicket(s, { type: "approve_plan", planned: true })).toMatchObject({ status: "working", wake: "ticket.plan_approved" });
        expect(transitionTicket(s, { type: "claim" })).toEqual({ ok: true, status: "working" });
        expect(transitionTicket(s, { type: "close", by: "claude" })).toMatchObject({ ok: true, status: "closed" });
      }
    });

    it("a press of Andrés (andres_acted) and a permission request leave paused and ongoing where they are", () => {
      for (const s of ["paused", "ongoing"] as const) {
        expect(transitionTicket(s, { type: "andres_acted" })).toEqual({ ok: true, status: s });
        expect(transitionTicket(s, { type: "permission_request" })).toEqual({ ok: true, status: s, wake: "ticket.permission_requested" });
      }
    });

    it("plan_skipped moves only Te espera to Claude trabaja, never wakes and never fails", () => {
      expect(transitionTicket("waiting_andres", { type: "plan_skipped" })).toEqual({ ok: true, status: "working" });
      for (const s of ["waiting_claude", "working", "paused", "ongoing", "closed"] as const) {
        expect(transitionTicket(s, { type: "plan_skipped" })).toMatchObject({ ok: s !== "closed", ...(s === "closed" ? {} : { status: s }) });
      }
    });

    it("has labels for both", () => {
      expect(TICKET_STATUS_LABEL.paused).toBe("En pausa");
      expect(TICKET_STATUS_LABEL.ongoing).toBe("En proceso");
    });
  });
});
