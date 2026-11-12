// The card of a call auto mode denied (t128 part H), server-rendered: what Andrés reads and which buttons exist.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Approval } from "@/lib/domain/types";
import { ApprovalCard } from "./ApprovalCard";

const base: Approval = {
  id: "ap_1",
  ticketId: "tk_1",
  ticketRef: "t128",
  kind: "denied",
  reason: "[Self-Modification]",
  deniedInput: "{}",
  rule: "Edit(//g/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/**)",
  agent: "dev-t128-2",
  tool: "Edit",
  summary: "Edit G:/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/calendar-body.mjs",
  detail: "--- old\na\n+++ new\nb",
  cwd: "G:/WorkSpace/designli",
  hints: [],
  status: "pending",
  decision: null,
  note: "",
  decidedBy: null,
  decidedAt: null,
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  isSample: false,
  createdAt: new Date().toISOString(),
};
const html = (a: Partial<Approval>) => renderToStaticMarkup(createElement(ApprovalCard, { approval: { ...base, ...a }, showTicket: true }));

describe("ApprovalCard, a denied call", () => {
  it("shows the reason, the call, the proposed rule and the two buttons", () => {
    const h = html({});
    expect(h).toContain("Bloqueado por el modo automático");
    expect(h).toContain("[Self-Modification]");
    expect(h).toContain("Regla propuesta");
    expect(h).toContain("Edit(//g/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/**)");
    expect(h).toContain("calendar-body.mjs");
    expect(h).toContain("ticket t128");
    expect(h).toContain("Permitir esta regla");
    expect(h).toContain("Denegar");
    expect(h).not.toContain("Dar permiso");
    expect(h).not.toContain("Lee tus configuraciones");
  });
  it("offers only Denegar, and says why, when no rule can be proposed", () => {
    const h = html({ rule: "", tool: "Bash", summary: "rm x", detail: "$ rm x" });
    expect(h).not.toContain("Permitir esta regla");
    expect(h).toContain("Sin regla que proponer");
    expect(h).toContain("Denegar");
  });
  it("collapses to one line with the rule once allowed, and to another once denied or expired", () => {
    expect(html({ status: "decided", decision: "allow", decidedBy: "andres", decidedAt: new Date().toISOString() })).toMatch(/Permitiste la regla.*Edit\(\/\/g\//);
    const denied = html({ status: "decided", decision: "deny", decidedBy: "andres", decidedAt: new Date().toISOString(), note: "no" });
    expect(denied).toContain("Denegaste el bloqueo");
    expect(denied).not.toContain("Permitir esta regla");
    expect(html({ status: "expired" })).toContain("el bloqueo sigue");
  });
  it("leaves the ordinary permission card as it was", () => {
    const h = html({ kind: "permission", rule: "", reason: "", tool: "Bash", summary: "git status", detail: "$ git status", hints: ["Bash(git status)"] });
    expect(h).toContain("Dar permiso");
    expect(h).toContain("Lee tus configuraciones");
    expect(h).not.toContain("Permitir esta regla");
    expect(h).not.toContain("Bloqueado por el modo automático");
  });
});
