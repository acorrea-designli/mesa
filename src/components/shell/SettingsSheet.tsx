"use client";
// "Ajustes" on the phone (opened by "Más" in the tab bar): every control the desktop rail keeps in its foot, because
// the rail is hidden at <= 720px. It reuses the rail's own components (Teléfono link, ThemeToggle, Hecho hoy, Uso, Deck, Fuentes),
// except the notification toggle: here it is the phone's Web Push row (PushRow). The theme persists exactly as on
// desktop (localStorage "mesa-theme").
// Closes with Esc, a tap outside (Sheet), or the phone's back gesture/button (one history entry while open).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import type { Counts } from "@/lib/domain/types";
import { PushRow } from "@/features/push/PushControl";
import { DeckLine } from "@/features/deck/DeckLine";
import { openDeckPanel } from "@/features/deck/panel";
import { UsageLine } from "@/features/usage/UsageLine";
import { Sheet, ThemeToggle } from "../ui/interactive";
import type { SourceHealth } from "./health";
import { SourceHealthList } from "./SourceHealthList";

const STATE = "mesaSettingsSheet";

/**
 * While `open`, one history entry stands for the sheet: back closes it instead of leaving the screen.
 * Returns `closeThen(fn)`: pops that entry first and runs `fn` after, so a link inside the sheet navigates from the
 * screen's own entry (a back() fired after the navigation would undo it).
 */
function useBackToClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  const thenRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    window.history.pushState({ ...(window.history.state as object | null), [STATE]: true }, "");
    let popped = false;
    const onPop = () => {
      popped = true;
      closeRef.current();
      const then = thenRef.current;
      thenRef.current = null;
      then?.();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed by Esc, a tap outside or a link: drop the entry we added (not when back already did).
      if (!popped && (window.history.state as Record<string, unknown> | null)?.[STATE]) window.history.back();
    };
  }, [open]);
  return useCallback((fn: () => void) => {
    thenRef.current = fn;
    window.history.back();
  }, []);
}

export function SettingsSheet({ open, onClose, counts, health }: { open: boolean; onClose: () => void; counts: Counts; health: (SourceHealth & { name: string })[] }) {
  const path = usePathname();
  const router = useRouter();
  const closeThen = useBackToClose(open, onClose);
  return (
    <Sheet open={open} onClose={onClose} title="Ajustes">
      <div className="set-list">
        <Link
          href="/telefono"
          className="nav theme"
          aria-current={path.startsWith("/telefono") ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            closeThen(() => router.push("/telefono"));
          }}
        >
          Teléfono
        </Link>
        {/* Web Push (t33). The desktop browser-notification toggle is not here: on a phone it only ends in "bloqueadas". */}
        <PushRow className="nav theme" onOpen={() => closeThen(() => router.push("/telefono"))} />
        <ThemeToggle className="theme" />
        <Link
          href="/semana"
          className="nav foot"
          aria-current={path.startsWith("/semana") ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            closeThen(() => router.push("/semana"));
          }}
        >
          Hecho hoy <b>{counts.doneToday}</b>
        </Link>
      </div>
      <UsageLine onDetail={(href) => closeThen(() => router.push(href))} />
      <DeckLine onOpen={() => closeThen(openDeckPanel)} />
      <SourceHealthList health={health} />
    </Sheet>
  );
}
