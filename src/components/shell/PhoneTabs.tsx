"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import type { Counts } from "@/lib/domain/types";
import { LineStub } from "../line/Line";
import { isActive, PHONE_NAV } from "./Rail";
import type { SourceHealth } from "./health";
import { SettingsSheet } from "./SettingsSheet";

/**
 * Phone bottom tab bar (replaces the rail at <= 720px): each tab is a line stub at 30% that goes full ink when active.
 * The last tab, "Más", opens the Ajustes sheet with the rail's foot controls (theme, avisos, Teléfono, Fuentes...) and
 * Calendario, whose tab Proyectos took (t152).
 */
export function PhoneTabs({ counts, health = [] }: { counts: Counts; health?: (SourceHealth & { name: string })[] }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const close = useCallback(() => setMore(false), []);
  return (
    <>
      <nav className="ph-tabs" aria-label="Navegación">
        {PHONE_NAV.map((n) => {
          const on = isActive(path, n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}>
              <span className="ln-wrap" style={{ opacity: on ? 1 : 0.3 }}>
                <LineStub source={on ? "ink" : n.line} width={20} />
              </span>
              <span>
                {n.label}
                <b>{n.count(counts)}</b>
              </span>
            </Link>
          );
        })}
        <button type="button" className="ph-more" aria-haspopup="dialog" aria-expanded={more} aria-label="Más: ajustes, tema y avisos" onClick={() => setMore(true)}>
          <svg width="20" height="6" viewBox="0 0 20 6" aria-hidden="true" fill="currentColor">
            <circle cx="3" cy="3" r="2.2" />
            <circle cx="10" cy="3" r="2.2" />
            <circle cx="17" cy="3" r="2.2" />
          </svg>
          <span>Más</span>
        </button>
      </nav>
      <SettingsSheet open={more} onClose={close} counts={counts} health={health} />
    </>
  );
}
