"use client";
// One salida's client state and actions, shared by the Salidas B card and
// <SalidaApproval>. Every press goes through the API (the server's state machine
// decides) and the fresh detail replaces the local copy.
import { useCallback, useRef, useState } from "react";
import type { Mark, SalidaDetail, SalidaSendMode } from "@/lib/domain/types";
import { useToast } from "@/components/ui/interactive";
import { salidaApi } from "./api";

export type Mode = "view" | "edit" | "pick";

export interface SalidaController<T extends SalidaDetail> {
  s: T;
  mode: Mode;
  setMode: (m: Mode) => void;
  busy: boolean;
  undone: boolean;
  openTurnId: string | null;
  rewritePending: boolean;
  /** The text is locked (not pending, or Claude is rewriting). */
  locked: boolean;
  /** `mode` is Slack only: omitted = draft (Aprobar), "send" = Aprobar y que Claude lo envíe. */
  approve: (mode?: SalidaSendMode) => Promise<boolean>;
  approveText: (body: string, mode?: SalidaSendMode) => Promise<boolean>;
  /** "Ya lo envié": Andrés sent the Slack draft himself. */
  confirmSent: () => Promise<void>;
  saveText: (body: string) => Promise<boolean>;
  undo: () => Promise<void>;
  deny: () => void;
  schedule: (at: string) => Promise<void>;
  unschedule: () => Promise<void>;
  reschedule: () => Promise<void>;
  retry: () => Promise<void>;
  unqueue: () => Promise<void>;
  requestDelete: () => Promise<void>;
  requestRestore: () => Promise<void>;
  select: (n: number) => Promise<void>;
  star: (n: number, on: boolean) => Promise<void>;
  turn: (body: string, marks: Mark[], chip?: string) => Promise<boolean>;
  cancelTurn: () => Promise<void>;
}

/** Deny waits this long so the toast's Deshacer can take it back (phone "denegada" state). */
export const DENY_GRACE_MS = 5000;

export function useSalidaController<T extends SalidaDetail>(
  server: T,
  opts: { onChange?: (d: SalidaDetail) => void; onDecided?: (id: string) => void; onUndecided?: (id: string) => void } = {},
): SalidaController<T> {
  const toast = useToast();
  const [local, setLocal] = useState<SalidaDetail | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [busy, setBusy] = useState(false);
  const [undone, setUndone] = useState(false);
  const [denying, setDenying] = useState(false);
  const denyTimer = useRef<number | null>(null);

  // Prefer whichever copy is newer: the server refresh or our last API answer.
  const fresh = local && local.id === server.id && local.updatedAt >= server.updatedAt ? local : null;
  const base: T = fresh ? ({ ...server, ...fresh } as T) : server;
  const s: T = denying ? ({ ...base, status: "denied" } as T) : base;

  const run = useCallback(
    async (fn: () => Promise<SalidaDetail>, ok?: string): Promise<boolean> => {
      setBusy(true);
      try {
        const d = await fn();
        setLocal(d);
        opts.onChange?.(d);
        if (ok) toast({ text: ok });
        return true;
      } catch (e) {
        toast({ text: e instanceof Error ? e.message : "No se pudo completar" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast, opts],
  );

  const openTurn = s.turns.find((t) => t.author === "andres" && t.state === "open") ?? null;
  const locked = s.status !== "pending" || Boolean(openTurn);

  return {
    s,
    mode,
    setMode,
    busy,
    undone: undone && s.status === "pending",
    openTurnId: openTurn?.id ?? null,
    rewritePending: Boolean(openTurn),
    locked,
    approve: async (mode) => {
      const ok = await run(() => salidaApi.approve(s.id, s.currentVersion, mode));
      if (ok) setUndone(false);
      return ok;
    },
    approveText: async (body, mode) => {
      setBusy(true);
      try {
        const e = await salidaApi.edit(s.id, body);
        const d = await salidaApi.approve(s.id, e.currentVersion, mode);
        setLocal(d);
        opts.onChange?.(d);
        setMode("view");
        return true;
      } catch (err) {
        toast({ text: err instanceof Error ? err.message : "No se pudo enviar" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    saveText: async (body) => {
      const ok = await run(() => salidaApi.edit(s.id, body), "Guardada como tu versión");
      if (ok) setMode("view");
      return ok;
    },
    undo: async () => {
      if (await run(() => salidaApi.undo(s.id))) setUndone(true);
    },
    deny: () => {
      if (denying) return;
      setDenying(true);
      opts.onDecided?.(s.id);
      const id = s.id;
      denyTimer.current = window.setTimeout(() => {
        denyTimer.current = null;
        void run(() => salidaApi.deny(id)).finally(() => setDenying(false));
      }, DENY_GRACE_MS);
      toast({
        text: "Denegada · no se envía nada",
        duration: DENY_GRACE_MS,
        action: {
          label: "Deshacer",
          onClick: () => {
            if (denyTimer.current) window.clearTimeout(denyTimer.current);
            denyTimer.current = null;
            setDenying(false);
            opts.onUndecided?.(id);
          },
        },
      });
    },
    schedule: async (at) => {
      if (await run(() => salidaApi.schedule(s.id, at, s.currentVersion))) setMode("view");
    },
    unschedule: async () => {
      await run(() => salidaApi.unschedule(s.id));
    },
    reschedule: async () => {
      if (await run(() => salidaApi.unschedule(s.id))) setMode("pick");
    },
    retry: async () => {
      await run(() => salidaApi.retry(s.id));
    },
    confirmSent: async () => {
      await run(() => salidaApi.confirmSent(s.id), "Marcada como enviada");
    },
    unqueue: async () => {
      await run(() => salidaApi.unqueue(s.id), "Sacada de la cola · vuelve a pendiente");
    },
    requestDelete: async () => {
      await run(() => salidaApi.requestDelete(s.id), "Pedido de borrado enviado a la sesión de Claude");
    },
    requestRestore: async () => {
      await run(() => salidaApi.requestRestore(s.id), "Pedido de restauración enviado");
    },
    select: async (n) => {
      await run(() => salidaApi.select(s.id, n));
    },
    star: async (n, on) => {
      await run(() => salidaApi.star(s.id, n, on));
    },
    turn: (body, marks, chip) => run(() => salidaApi.turn(s.id, { body: body || undefined, marks: marks.length ? marks : undefined, chipLabel: chip })),
    cancelTurn: async () => {
      if (openTurn) await run(() => salidaApi.cancelTurn(s.id, openTurn.id));
    },
  };
}
