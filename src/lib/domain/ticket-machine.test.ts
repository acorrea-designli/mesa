import { describe, expect, it } from "vitest";
import { initialTicketStatus, transitionTicket } from "./ticket-machine";

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

  it("approving a plan needs one waiting", () => {
    expect(transitionTicket("waiting_andres", { type: "approve_plan" })).toEqual({
      ok: true,
      status: "working",
      wake: "ticket.plan_approved",
    });
    expect(transitionTicket("working", { type: "approve_plan" }).ok).toBe(false);
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
});
