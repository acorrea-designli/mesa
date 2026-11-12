import { describe, expect, it } from "vitest";
import { dueEvent, TERMINAL, transitionSalida, UNDO_WINDOW_MS, type SalidaEvent, type SalidaGuards } from "./salida-machine";
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
  sendMode: null,
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

describe("salida machine: Slack send modes", () => {
  const released = (mode?: "draft" | "send", dest: Destination = slack) =>
    run(run(base({ destination: dest }), { type: "approve", version: 1, mode }), { type: "release" }, at(UNDO_WINDOW_MS));

  it("a Slack approval records the mode (default draft) and keeps it through release", () => {
    expect(run(base(), { type: "approve", version: 1 }).sendMode).toBe("draft");
    expect(run(base(), { type: "approve", version: 1, mode: "send" }).sendMode).toBe("send");
    expect(released("send").sendMode).toBe("send");
    expect(released().sendMode).toBe("draft");
  });

  it("the mode also survives approve while the source is down, hold and resume", () => {
    const queued = run(base(), { type: "approve", version: 1, mode: "send" }, T0, { ...g, sourceDown: true });
    expect(queued).toMatchObject({ status: "queued_until_back", sendMode: "send" });
    expect(run(queued, { type: "resume" }, at(1_000))).toMatchObject({ status: "sending", sendMode: "send" });
    const held = run(released("send"), { type: "hold", reason: "ya hay un borrador en ese canal" });
    expect(held.sendMode).toBe("send");
  });

  it("an undo clears the mode; so do unqueue, bounce, retry, deny and unschedule", () => {
    const sending = run(base(), { type: "approve", version: 1, mode: "send" });
    expect(run(sending, { type: "undo" }, at(1_000)).sendMode).toBeNull();
    const q = run(base(), { type: "approve", version: 1, mode: "send" }, T0, { ...g, sourceDown: true });
    expect(run(q, { type: "unqueue" }).sendMode).toBeNull();
    expect(run(q, { type: "deny" }).sendMode).toBeNull();
    expect(run(released("send"), { type: "bounce", reason: "new messages" }).sendMode).toBeNull();
    expect(run(run(released("send"), { type: "failed", error: "x" }), { type: "retry" }).sendMode).toBeNull();
    const scheduled = run(base(), { type: "schedule", at: at(3_600_000).toISOString(), version: 1, mode: "send" });
    expect(run(scheduled, { type: "unschedule" }).sendMode).toBeNull();
  });

  it("Programar records a mode too (default draft) and the release keeps it", () => {
    const when = at(3_600_000).toISOString();
    expect(run(base(), { type: "schedule", at: when, version: 1 }).sendMode).toBe("draft");
    const scheduled = run(base(), { type: "schedule", at: when, version: 1, mode: "send" });
    expect(scheduled.sendMode).toBe("send");
    const r = transitionSalida(scheduled, { type: "release" }, at(3_600_000), g);
    expect(r).toMatchObject({ ok: true, wake: "salida.released" });
    expect(run(scheduled, { type: "release" }, at(3_600_000)).sendMode).toBe("send");
  });

  it("non-Slack salidas have no mode and refuse one", () => {
    expect(run(base({ destination: bcComment }), { type: "approve", version: 1 }).sendMode).toBeNull();
    expect(run(base({ destination: campfire }), { type: "schedule", at: at(3_600_000).toISOString(), version: 1 }).sendMode).toBeNull();
    expect(transitionSalida(base({ destination: bcComment }), { type: "approve", version: 1, mode: "draft" }, T0, g)).toMatchObject({ ok: false });
    expect(transitionSalida(base({ destination: campfire }), { type: "schedule", at: at(3_600_000).toISOString(), version: 1, mode: "send" }, T0, g)).toMatchObject({ ok: false });
  });

  it("drafted needs a released draft-mode Slack salida and moves it to draft_created", () => {
    const sending = run(base(), { type: "approve", version: 1 });
    expect(transitionSalida(sending, { type: "drafted" }, at(1_000), g)).toMatchObject({ ok: false }); // undo window open
    const d = run(released("draft"), { type: "drafted" }, at(UNDO_WINDOW_MS + 500));
    expect(d).toMatchObject({ status: "draft_created", draftedAt: at(UNDO_WINDOW_MS + 500).toISOString(), sendMode: "draft" });
    // never for a salida approved as "Claude lo envía", a pending one, or another source
    expect(transitionSalida(released("send"), { type: "drafted" }, at(UNDO_WINDOW_MS), g)).toMatchObject({ ok: false });
    expect(transitionSalida(base(), { type: "drafted" }, T0, g)).toMatchObject({ ok: false });
    expect(transitionSalida(released(undefined, bcComment), { type: "drafted" }, at(UNDO_WINDOW_MS), g)).toMatchObject({ ok: false });
  });

  it("draft_created is not sent, never re-releases and cannot be undone, retried or denied", () => {
    const d = run(released("draft"), { type: "drafted" }, at(UNDO_WINDOW_MS));
    for (const ev of [{ type: "release" }, { type: "sent" }, { type: "undo" }, { type: "retry" }, { type: "deny" }, { type: "approve", version: 1 }, { type: "drafted" }, { type: "hold", reason: "x" }, { type: "request_delete" }] as SalidaEvent[]) {
      expect(transitionSalida(d, ev, at(UNDO_WINDOW_MS * 3), g), ev.type).toMatchObject({ ok: false });
    }
    expect(dueEvent(d, at(UNDO_WINDOW_MS * 3))).toBeNull();
  });

  it("\"Ya lo envié\" closes a draft_created salida as sent, and only that", () => {
    const d = run(released("draft"), { type: "drafted" }, at(UNDO_WINDOW_MS));
    const sent = run(d, { type: "confirm_sent" }, at(UNDO_WINDOW_MS + 60_000));
    expect(sent).toMatchObject({ status: "sent", sentAt: at(UNDO_WINDOW_MS + 60_000).toISOString() });
    expect(transitionSalida(released("send"), { type: "confirm_sent" }, at(UNDO_WINDOW_MS), g)).toMatchObject({ ok: false });
    expect(transitionSalida(base(), { type: "confirm_sent" }, T0, g)).toMatchObject({ ok: false });
    expect(transitionSalida(sent, { type: "confirm_sent" }, at(UNDO_WINDOW_MS * 4), g)).toMatchObject({ ok: false });
  });

  describe("withdraw (the lead's cleanup, t123)", () => {
    const withdraw: SalidaEvent = { type: "withdraw", reason: "stale leftover of mesa#36" };

    it("moves a pending or draft salida to withdrawn with its reason and time, and never wakes", () => {
      for (const status of ["pending", "draft"] as const) {
        const r = transitionSalida(base({ status }), withdraw, T0, g);
        expect(r).toEqual({ ok: true, patch: { status: "withdrawn", withdrawReason: "stale leftover of mesa#36", withdrawnAt: T0.toISOString(), sendAt: null } });
      }
    });

    it("needs a non-empty reason", () => {
      expect(transitionSalida(base(), { type: "withdraw", reason: "  " }, T0, g)).toMatchObject({ ok: false });
    });

    it("is refused from every other status", () => {
      for (const status of ["sending", "scheduled", "queued_until_back", "draft_created", "sent", "failed", "denied", "expired", "deleted", "withdrawn"] as const) {
        expect(transitionSalida(base({ status, sendAt: status === "scheduled" ? at(60_000).toISOString() : null }), withdraw, T0, g), status).toMatchObject({ ok: false });
      }
    });

    it("sets nothing that sends and is a deny in nothing but its end", () => {
      const r = transitionSalida(base(), withdraw, T0, g);
      expect(r.ok && Object.keys(r.patch).sort()).toEqual(["sendAt", "status", "withdrawReason", "withdrawnAt"]);
      expect(r.ok && r.wake).toBeUndefined();
      expect(TERMINAL).toContain("withdrawn");
    });

    it("nothing leaves withdrawn: no approval, schedule, release, send, retry, resume or undo, and nothing is due", () => {
      const w = run(base(), withdraw);
      const evs: SalidaEvent[] = [
        { type: "approve", version: 1 },
        { type: "schedule", at: at(60_000).toISOString(), version: 1 },
        { type: "release" },
        { type: "sent" },
        { type: "drafted" },
        { type: "confirm_sent" },
        { type: "failed", error: "x" },
        { type: "retry" },
        { type: "resume" },
        { type: "undo" },
        { type: "deny" },
        { type: "expire" },
        { type: "unschedule" },
        { type: "unqueue" },
        { type: "hold", reason: "x" },
        { type: "bounce", reason: "x" },
        { type: "propose" },
        { type: "request_delete" },
        { type: "deleted" },
        { type: "withdraw", reason: "again" },
      ];
      for (const ev of evs) expect(transitionSalida(w, ev, at(UNDO_WINDOW_MS * 10), g), ev.type).toMatchObject({ ok: false });
      expect(dueEvent({ ...w, expiresAt: T0.toISOString(), sendAt: T0.toISOString(), undoUntil: T0.toISOString() }, at(UNDO_WINDOW_MS * 10))).toBeNull();
    });
  });
});
