import { describe, expect, it } from "vitest";
import { dueEvent, transitionSalida, UNDO_WINDOW_MS, type SalidaEvent, type SalidaGuards } from "./salida-machine";
import type { Destination, Salida } from "./types";

const slack: Destination = { kind: "slack_thread", workspace: "Designli", channel: "#scout-dev", postAs: "Andrés" };
const bcComment: Destination = { kind: "basecamp_comment", project: "Scout", postAs: "Andrés" };
const campfire: Destination = { kind: "basecamp_campfire", project: "Scout", postAs: "Andrés" };

type S = Parameters<typeof transitionSalida>[0];
const base = (over: Partial<Salida> = {}): S => ({
  status: "pending",
  destination: slack,
  undoUntil: null,
  releasedAt: null,
  sendAt: null,
  expiresAt: null,
  currentVersion: 1,
  approvedVersion: null,
  deleteRequestedAt: null,
  ...over,
});
const T0 = new Date("2026-11-03T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const g: SalidaGuards = { versionCount: 1, rewritePending: false };

function run(s: S, ev: SalidaEvent, now = T0, guards = g): S {
  const r = transitionSalida(s, ev, now, guards);
  if (!r.ok) throw new Error(r.error);
  return { ...s, ...r.patch };
}

describe("salida machine", () => {
  it("draft is proposed only with a version", () => {
    expect(transitionSalida(base({ status: "draft" }), { type: "propose" }, T0, { ...g, versionCount: 0 }).ok).toBe(false);
    expect(run(base({ status: "draft" }), { type: "propose" }).status).toBe("pending");
  });

  it("approve opens a 20 s undo window on the shown version", () => {
    const s = run(base(), { type: "approve", version: 1 });
    expect(s.status).toBe("sending");
    expect(s.approvedVersion).toBe(1);
    expect(Date.parse(s.undoUntil!)).toBe(T0.getTime() + UNDO_WINDOW_MS);
    expect(s.releasedAt).toBeNull();
  });

  it("refuses approving a version other than the one shown", () => {
    const r = transitionSalida(base({ currentVersion: 2 }), { type: "approve", version: 1 }, T0, { ...g, versionCount: 2 });
    expect(r.ok).toBe(false);
  });

  it("refuses approving while Claude is rewriting", () => {
    const r = transitionSalida(base(), { type: "approve", version: 1 }, T0, { ...g, rewritePending: true });
    expect(r).toMatchObject({ ok: false });
  });

  it("undo inside the window returns to pending; after it, refuses", () => {
    const sending = run(base(), { type: "approve", version: 1 });
    const undone = transitionSalida(sending, { type: "undo" }, at(19_999), g);
    expect(undone).toMatchObject({ ok: true, wake: "salida.undone", patch: { status: "pending" } });
    expect(transitionSalida(sending, { type: "undo" }, at(UNDO_WINDOW_MS), g).ok).toBe(false);
  });

  it("release only after the window, once, and wakes the owner", () => {
    const sending = run(base(), { type: "approve", version: 1 });
    expect(transitionSalida(sending, { type: "release" }, at(5_000), g).ok).toBe(false);
    const r = transitionSalida(sending, { type: "release" }, at(UNDO_WINDOW_MS), g);
    expect(r).toMatchObject({ ok: true, wake: "salida.released" });
    const released = run(sending, { type: "release" }, at(UNDO_WINDOW_MS));
    expect(transitionSalida(released, { type: "release" }, at(UNDO_WINDOW_MS + 1), g).ok).toBe(false);
  });

  it("sent and failed require the release", () => {
    const sending = run(base(), { type: "approve", version: 1 });
    expect(transitionSalida(sending, { type: "sent" }, at(1), g).ok).toBe(false);
    const released = run(sending, { type: "release" }, at(UNDO_WINDOW_MS));
    expect(run(released, { type: "sent", permalink: "https://x" }, at(UNDO_WINDOW_MS + 500)).status).toBe("sent");
    const failed = run(released, { type: "failed", error: "channel_not_found" }, at(UNDO_WINDOW_MS + 500));
    expect(failed.status).toBe("failed");
    expect(run(failed, { type: "retry" }).status).toBe("pending");
  });

  it("deny from pending, draft or scheduled; not from sent", () => {
    expect(run(base(), { type: "deny" }).status).toBe("denied");
    expect(run(base({ status: "scheduled", sendAt: at(60_000).toISOString() }), { type: "deny" }).status).toBe("denied");
    expect(transitionSalida(base({ status: "sent" }), { type: "deny" }, T0, g).ok).toBe(false);
  });

  it("schedule needs a future time and releases at send_at", () => {
    expect(transitionSalida(base(), { type: "schedule", at: at(-1).toISOString(), version: 1 }, T0, g).ok).toBe(false);
    const sch = run(base(), { type: "schedule", at: at(3_600_000).toISOString(), version: 1 });
    expect(sch.status).toBe("scheduled");
    expect(dueEvent(sch, at(10))).toBeNull();
    expect(dueEvent(sch, at(3_600_000))).toEqual({ type: "release" });
    const rel = run(sch, { type: "release" }, at(3_600_000));
    expect(rel).toMatchObject({ status: "sending" });
    expect(rel.releasedAt).not.toBeNull();
    expect(run(sch, { type: "unschedule" }).status).toBe("pending");
  });

  it("expires a pending salida past expires_at", () => {
    const s = base({ expiresAt: at(1000).toISOString() });
    expect(dueEvent(s, at(999))).toBeNull();
    expect(dueEvent(s, at(1000))).toEqual({ type: "expire" });
    expect(run(s, { type: "expire" }, at(1000)).status).toBe("expired");
  });

  it("delete follows the destination policy", () => {
    expect(transitionSalida(base({ status: "sent" }), { type: "request_delete" }, T0, g).ok).toBe(false);
    const bc = run(base({ status: "sent", destination: bcComment }), { type: "request_delete" });
    expect(bc.deleteRequestedAt).not.toBeNull();
    const deleted = run(bc, { type: "deleted" });
    expect(deleted.status).toBe("deleted");
    expect(transitionSalida(deleted, { type: "request_restore" }, T0, g)).toMatchObject({ ok: true, wake: "salida.restore_requested" });
    expect(run(deleted, { type: "restored" }).status).toBe("sent");

    const cf = run(run(base({ status: "sent", destination: campfire }), { type: "request_delete" }), { type: "deleted" });
    expect(transitionSalida(cf, { type: "request_restore" }, T0, g).ok).toBe(false);
  });

  it("dueEvent releases sending items whose window ended", () => {
    const sending = run(base(), { type: "approve", version: 1 });
    expect(dueEvent(sending, at(UNDO_WINDOW_MS - 1))).toBeNull();
    expect(dueEvent(sending, at(UNDO_WINDOW_MS))).toEqual({ type: "release" });
  });
});

describe("salida machine: source outages", () => {
  it("approve while the source is down queues it (Aprobar al volver)", () => {
    const r = transitionSalida(base(), { type: "approve", version: 1 }, T0, { ...g, sourceDown: true });
    expect(r).toMatchObject({ ok: true, wake: "salida.queued", patch: { status: "queued_until_back", approvedVersion: 1 } });
  });

  it("a released salida can hold, then resume releases it again", () => {
    const released = run(run(base(), { type: "approve", version: 1 }), { type: "release" }, at(UNDO_WINDOW_MS));
    const held = run(released, { type: "hold", reason: "slack unreachable" });
    expect(held).toMatchObject({ status: "queued_until_back", releasedAt: null });
    const r = transitionSalida(held, { type: "resume" }, at(60_000), g);
    expect(r).toMatchObject({ ok: true, wake: "salida.released", patch: { status: "sending" } });
  });

  it("hold refuses inside the undo window", () => {
    const sending = run(base(), { type: "approve", version: 1 });
    expect(transitionSalida(sending, { type: "hold", reason: "x" }, at(1), g).ok).toBe(false);
  });

  it("unqueue and deny pull a queued salida back; bounce asks for a new approval", () => {
    const q = run(base(), { type: "approve", version: 1 }, T0, { ...g, sourceDown: true });
    expect(run(q, { type: "unqueue" }).status).toBe("pending");
    expect(run(q, { type: "deny" }).status).toBe("denied");
    const b = run(q, { type: "bounce", reason: "new messages in the thread" });
    expect(b).toMatchObject({ status: "pending", approvedVersion: null, error: "new messages in the thread" });
  });
});
