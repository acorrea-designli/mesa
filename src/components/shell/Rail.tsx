"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Counts, Source } from "@/lib/domain/types";
import { SOURCE_LABEL } from "@/lib/domain/types";
import { BrandMark, BrokenLine, LineStub } from "../line/Line";
import { ThemeToggle } from "../ui/interactive";
import { usePress } from "@/lib/motion";

export const NAV = [
  { href: "/", label: "Hoy", count: (c: Counts) => c.hoy, line: "ink" as const },
  { href: "/tablero", label: "Tablero", count: (c: Counts) => c.tablero, line: "github" as const },
  { href: "/tickets", label: "Tickets", count: (c: Counts) => c.tickets, line: "claude" as const },
  { href: "/salidas", label: "Salidas", count: (c: Counts) => c.salidas, line: "slack" as const },
];

export const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

/** Source health for the rail notice (Estados B). Empty until lane C reports it. */
export interface SourceHealth {
  source: Source | "github_project";
  state: "ok" | "degraded" | "down";
  note: string; // "sin conexión", "límite de API · 14:05"
}

export function Rail({ counts, health = [] }: { counts: Counts; health?: SourceHealth[] }) {
  const path = usePathname();
  const ref = usePress<HTMLElement>(".nav");
  return (
    <aside className="rail" ref={ref} aria-label="Navegación">
      <div className="brand">
        <BrandMark />
        Mesa
      </div>
      <div className="who">Designli · Andrés</div>
      <nav className="rail-nav">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="nav" aria-current={isActive(path, n.href) ? "page" : undefined}>
            {n.label} <b>{n.count(counts)}</b>
          </Link>
        ))}
      </nav>
      <div className="rail-foot">
        {health.length ? (
          <div className="rl-health" aria-label="Fuentes">
            <div className="k">Fuentes</div>
            {health.map((h) => {
              const src = h.source === "github_project" ? "github" : h.source;
              const name = h.source === "github_project" ? "GitHub Project" : SOURCE_LABEL[h.source];
              return (
                <div key={h.source} className={h.state === "ok" ? "rl-src" : "rl-src bad"}>
                  {h.state === "ok" ? <LineStub source={src} width={16} /> : <BrokenLine source={src} width={24} />}
                  {name}
                  <small>{h.note}</small>
                </div>
              );
            })}
          </div>
        ) : null}
        <span className="nav foot">
          Hecho hoy <b>{counts.doneToday}</b>
        </span>
        <ThemeToggle className="theme" />
      </div>
    </aside>
  );
}
