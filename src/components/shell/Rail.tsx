"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Counts } from "@/lib/domain/types";
import { BrandMark, BrokenLine, LineStub } from "../line/Line";
import { NotifyToggle, SoundToggle } from "@/features/notify/NotifyToggle";
import { ThemeToggle } from "../ui/interactive";
import { usePress } from "@/lib/motion";
import type { SourceHealth } from "./health";

export type { SourceHealth } from "./health";

export const NAV = [
  { href: "/", label: "Hoy", count: (c: Counts) => c.hoy, line: "ink" as const },
  { href: "/tablero", label: "Tablero", count: (c: Counts) => c.tablero, line: "github" as const },
  { href: "/tickets", label: "Tickets", count: (c: Counts) => c.tickets, line: "claude" as const },
  { href: "/salidas", label: "Salidas", count: (c: Counts) => c.salidas, line: "slack" as const },
];

export const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function Rail({ counts, health = [] }: { counts: Counts; health?: (SourceHealth & { name: string })[] }) {
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
        {counts.approvals > 0 ? (
          <Link href="/#permisos" className="rl-perm">
            <span className="rl-perm-dot" aria-hidden="true" />
            {counts.approvals === 1 ? "1 permiso espera" : `${counts.approvals} permisos esperan`}
          </Link>
        ) : null}
      </nav>
      <div className="rail-foot">
        {health.length ? (
          <div className="rl-health" role="status" aria-label="Fuentes">
            <div className="k">Fuentes</div>
            {health.map((h) => {
              const line = h.source === "github_project" ? "github" : h.source;
              return (
                <div key={h.source} className={h.state === "ok" ? "rl-src" : "rl-src bad"}>
                  {h.state === "ok" ? <LineStub source={line} width={16} /> : <BrokenLine source={line} width={24} title={`${h.name} ${h.note}`} />}
                  {h.name}
                  <small>{h.note}</small>
                </div>
              );
            })}
          </div>
        ) : null}
        <span className="nav foot">
          Hecho hoy <b>{counts.doneToday}</b>
        </span>
        <Link href="/telefono" className="nav theme" aria-current={path.startsWith("/telefono") ? "page" : undefined}>
          Teléfono
        </Link>
        <NotifyToggle className="nav theme" />
        <SoundToggle className="nav theme" />
        <ThemeToggle className="theme" />
      </div>
    </aside>
  );
}
