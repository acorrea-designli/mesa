// Salida (outgoing message) state machine. Pure: no IO, time is passed in.
//
//   draft ──propose──▶ pending ──approve──▶ sending (undo window) ──release──▶ sending(released)
//     │                 │  ▲  │                 │ undo ▲                          │ sent / failed
//     │                 │  │  └─schedule─▶ scheduled ─(send_at)─▶ sending(released)│
//     │                 │  └──unschedule──────┘                                    ▼
//     │                 │   (approve while the source is down ──▶ queued_until_back ─resume─▶ sending(released))
//     │                 ├─deny──▶ denied                       sent ──deleted──▶ deleted
//     │                 └─expire─▶ expired                     failed ──retry──▶ pending
//
// The session that owns a salida only executes the send after the `release`
// (the 20 s undo window is over). `sent` before release is refused.

import { DELETE_POLICY, type Salida, type SalidaStatus, type WakeKind } from "./types";

export const UNDO_WINDOW_MS = 20_000;

export type SalidaEvent =
  | { type: "propose" }
  | { type: "approve"; version: number }
  | { type: "undo" }
  | { type: "release" }
  | { type: "sent"; permalink?: string }
  | { type: "failed"; error: string }
  | { type: "retry" }
  | { type: "deny" }
  | { type: "expire" }
  | { type: "schedule"; at: string; version: number }
  | { type: "unschedule" }
  | { type: "request_delete" }
  | { type: "deleted" }
  | { type: "request_restore" }
  | { type: "restored" }
  | { type: "hold"; reason: string } // released, but the source is down: wait for it
  | { type: "resume" } // the source is back: release again (the session re-checks the thread)
  | { type: "unqueue" } // Andrés pulls a queued salida back to pending
  | { type: "bounce"; reason: string }; // the thread changed before sending: back to pending for a new approval

export type SalidaEventType = SalidaEvent["type"];

/** Facts the machine needs that are not on the salida row. */
export interface SalidaGuards {
  /** Number of versions that exist (versions are 1..versionCount). */
  versionCount: number;
  /** A refine turn is waiting for Claude ("Claude reescribiendo…"). */
  rewritePending: boolean;
  /** The destination source is reported down ("Aprobar al volver"). */
  sourceDown?: boolean;
}

export type Transition =
  | { ok: true; patch: Partial<Salida>; wake?: WakeKind }
  | { ok: false; error: string };

type S = Pick<
  Salida,
  | "status"
  | "destination"
  | "undoUntil"
  | "releasedAt"
  | "sendAt"
  | "expiresAt"
  | "currentVersion"
  | "approvedVersion"
  | "deleteRequestedAt"
>;

const fail = (error: string): Transition => ({ ok: false, error });

function expect(s: S, allowed: SalidaStatus[], event: string): Transition | null {
  return allowed.includes(s.status) ? null : fail(`cannot ${event} a salida that is ${s.status}`);
}

/** Statuses in which Claude may add a new version (the text is not locked yet). */
export function canAddVersion(status: SalidaStatus): boolean {
  return status === "draft" || status === "pending";
}

/** Statuses that are final (no more transitions except delete/restore on sent/deleted). */
export const TERMINAL: SalidaStatus[] = ["denied", "expired"];

export function transitionSalida(s: S, ev: SalidaEvent, now: Date, g: SalidaGuards): Transition {
  const iso = now.toISOString();
  switch (ev.type) {
    case "propose": {
      const bad = expect(s, ["draft"], "propose");
      if (bad) return bad;
      if (g.versionCount < 1) return fail("a salida needs a version before it is proposed");
      return { ok: true, patch: { status: "pending" } };
    }

    case "approve": {
      const bad = expect(s, ["pending"], "approve");
      if (bad) return bad;
      if (g.rewritePending) return fail("Claude is rewriting; approve the new version when it arrives");
      if (ev.version < 1 || ev.version > g.versionCount) return fail(`version ${ev.version} does not exist`);
      if (ev.version !== s.currentVersion) return fail("approve sends the version shown; select it first");
      if (g.sourceDown) {
        return {
          ok: true,
          patch: { status: "queued_until_back", approvedVersion: ev.version, undoUntil: null, releasedAt: null, error: null },
          wake: "salida.queued",
        };
      }
      return {
        ok: true,
        patch: {
          status: "sending",
          approvedVersion: ev.version,
          undoUntil: new Date(now.getTime() + UNDO_WINDOW_MS).toISOString(),
          releasedAt: null,
          error: null,
        },
      };
    }

    case "undo": {
      const bad = expect(s, ["sending"], "undo");
      if (bad) return bad;
      if (s.releasedAt || !s.undoUntil || now.getTime() >= Date.parse(s.undoUntil)) {
        return fail("the undo window is over");
      }
      return {
        ok: true,
        patch: { status: "pending", approvedVersion: null, undoUntil: null },
        wake: "salida.undone",
      };
    }

    case "release": {
      if (s.status === "scheduled") {
        if (!s.sendAt || now.getTime() < Date.parse(s.sendAt)) return fail("not time to send yet");
        return {
          ok: true,
          patch: { status: "sending", undoUntil: s.sendAt, releasedAt: iso },
          wake: "salida.released",
        };
      }
      const bad = expect(s, ["sending"], "release");
      if (bad) return bad;
      if (s.releasedAt) return fail("already released");
      if (!s.undoUntil || now.getTime() < Date.parse(s.undoUntil)) return fail("the undo window is still open");
      return { ok: true, patch: { releasedAt: iso }, wake: "salida.released" };
    }

    case "sent": {
      const bad = expect(s, ["sending"], "mark sent");
      if (bad) return bad;
      if (!s.releasedAt) return fail("refusing to mark sent before the undo window is over");
      return { ok: true, patch: { status: "sent", sentAt: iso, permalink: ev.permalink ?? null, error: null } };
    }

    case "failed": {
      const bad = expect(s, ["sending"], "mark failed");
      if (bad) return bad;
      if (!s.releasedAt) return fail("refusing to mark failed before the undo window is over");
      return { ok: true, patch: { status: "failed", error: ev.error } };
    }

    case "retry": {
      const bad = expect(s, ["failed"], "retry");
      if (bad) return bad;
      return {
        ok: true,
        patch: { status: "pending", approvedVersion: null, undoUntil: null, releasedAt: null },
      };
    }

    case "deny": {
      const bad = expect(s, ["draft", "pending", "scheduled", "queued_until_back"], "deny");
      if (bad) return bad;
      return { ok: true, patch: { status: "denied", sendAt: null }, wake: "salida.denied" };
    }

    case "expire": {
      const bad = expect(s, ["pending"], "expire");
      if (bad) return bad;
      if (!s.expiresAt || now.getTime() < Date.parse(s.expiresAt)) return fail("not expired yet");
      return { ok: true, patch: { status: "expired" } };
    }

    case "schedule": {
      const bad = expect(s, ["pending"], "schedule");
      if (bad) return bad;
      if (g.rewritePending) return fail("Claude is rewriting; schedule the new version when it arrives");
      if (ev.version !== s.currentVersion) return fail("schedule sends the version shown; select it first");
      const at = Date.parse(ev.at);
      if (Number.isNaN(at)) return fail("invalid schedule time");
      if (at <= now.getTime()) return fail("schedule time must be in the future");
      return {
        ok: true,
        patch: { status: "scheduled", sendAt: new Date(at).toISOString(), approvedVersion: ev.version },
      };
    }

    case "unschedule": {
      const bad = expect(s, ["scheduled"], "unschedule");
      if (bad) return bad;
      return { ok: true, patch: { status: "pending", sendAt: null, approvedVersion: null } };
    }

    case "request_delete": {
      const bad = expect(s, ["sent"], "delete");
      if (bad) return bad;
      if (DELETE_POLICY[s.destination.kind] === "none") {
        return fail("this destination does not allow deleting from Mesa; open it at the source");
      }
      if (s.deleteRequestedAt) return fail("delete already requested");
      return { ok: true, patch: { deleteRequestedAt: iso }, wake: "salida.delete_requested" };
    }

    case "deleted": {
      const bad = expect(s, ["sent"], "mark deleted");
      if (bad) return bad;
      if (!s.deleteRequestedAt) return fail("delete was not requested");
      return { ok: true, patch: { status: "deleted", deletedAt: iso } };
    }

    case "request_restore": {
      const bad = expect(s, ["deleted"], "restore");
      if (bad) return bad;
      if (DELETE_POLICY[s.destination.kind] !== "trash") return fail("this deletion is permanent");
      return { ok: true, patch: {}, wake: "salida.restore_requested" };
    }

    case "hold": {
      const bad = expect(s, ["sending"], "hold");
      if (bad) return bad;
      if (!s.releasedAt) return fail("only a released salida can wait for its source");
      return { ok: true, patch: { status: "queued_until_back", releasedAt: null, error: ev.reason } };
    }

    case "resume": {
      const bad = expect(s, ["queued_until_back"], "resume");
      if (bad) return bad;
      return { ok: true, patch: { status: "sending", undoUntil: iso, releasedAt: iso, error: null }, wake: "salida.released" };
    }

    case "unqueue": {
      const bad = expect(s, ["queued_until_back"], "unqueue");
      if (bad) return bad;
      return { ok: true, patch: { status: "pending", approvedVersion: null, error: null } };
    }

    case "bounce": {
      const bad = expect(s, ["sending", "queued_until_back"], "bounce");
      if (bad) return bad;
      if (s.status === "sending" && !s.releasedAt) return fail("the undo window is still open; Andrés can undo");
      return {
        ok: true,
        patch: { status: "pending", approvedVersion: null, undoUntil: null, releasedAt: null, error: ev.reason },
      };
    }

    case "restored": {
      const bad = expect(s, ["deleted"], "mark restored");
      if (bad) return bad;
      return { ok: true, patch: { status: "sent", deletedAt: null, deleteRequestedAt: null } };
    }
  }
}

/**
 * Time-driven transitions due at `now`, in the order the sweeper should apply them.
 * Returns the event to apply, or null when nothing is due.
 */
export function dueEvent(s: S, now: Date): SalidaEvent | null {
  const t = now.getTime();
  if (s.status === "sending" && !s.releasedAt && s.undoUntil && t >= Date.parse(s.undoUntil)) {
    return { type: "release" };
  }
  if (s.status === "scheduled" && s.sendAt && t >= Date.parse(s.sendAt)) return { type: "release" };
  if (s.status === "pending" && s.expiresAt && t >= Date.parse(s.expiresAt)) return { type: "expire" };
  return null;
}
