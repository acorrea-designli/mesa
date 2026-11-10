"use client";
// Whether the deck panel is open. One module-level flag, so the rail row, the phone's Ajustes sheet and the host that
// draws the dialog (mounted once in AppShell, outside any sheet) never need to share a parent.
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

const set = (v: boolean) => {
  if (open === v) return;
  open = v;
  listeners.forEach((l) => l());
};

export const openDeckPanel = () => set(true);
export const closeDeckPanel = () => set(false);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useDeckPanelOpen = () =>
  useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
