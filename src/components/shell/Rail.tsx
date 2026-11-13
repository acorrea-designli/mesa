"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Counts } from "@/lib/domain/types";
import { useIdentity } from "../identity";
import { BrandMark } from "../line/Line";
import { NotifyToggle, SoundToggle } from "@/features/notify/NotifyToggle";
import { ThemeToggle } from "../ui/interactive";
import { DeckLine } from "@/features/deck/DeckLine";
import { UsageLine } from "@/features/usage/UsageLine";
import { useLiveRefresh } from "@/lib/live/useLive";
import { usePress } from "@/lib/motion";
import type { SourceHealth } from "./health";
import { SourceHealthList } from "./SourceHealthList";

export type { SourceHealth } from "./health";

export const NAV = [
  { href: "/", label: "Hoy", count: (c: Counts) => c.hoy, line: "ink" as const },
  { href: "/tablero", label: "Tablero", count: (c: Counts) => c.tablero, line: "github" as const },
  { href: "/tickets", label: "Tickets", count: (c: Counts) => c.tickets, line: "claude" as const },
  { href: "/salidas", label: "Salidas", count: (c: Counts) => c.salidas, line: "slack" as const },
  { href: "/calendario", label: "Calendario", count: (c: Counts) => c.calendar, line: "calendar" as const },
  // Open PRs of the client GitHub Projects (t152); GitHub red, as PR lines are.
  { href: "/proyectos", label: "Proyectos", count: (c: Counts) => c.proyectos, line: "github" as const },
];

/** The phone tab bar (t152): Proyectos takes Calendario's place, which moves into the Más sheet. */
export const PHONE_NAV = NAV.filter((n) => n.href !== "/calendario");

export const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function Rail({ counts, health = [] }: { counts: Counts; health?: (SourceHealth & { name: string })[] }) {
  const path = usePathname();
  const { ownerName } = useIdentity();
  const ref = usePress<HTMLElement>(".nav");
  // The Fuentes rows change with the clock and with sessions, not only with writes (health-ticker.ts):
  // refresh on source changes on every screen, including those with no live refresh of their own. "proyectos" keeps
  // the Proyectos count current when the GitHub Projects reader writes the cache.
  useLiveRefresh({ entityTypes: ["source", "proyectos"] });
  return (
    <aside className="rail" ref={ref} aria-label="Navegación">
      <div className="brand">
        <BrandMark />
        Mesa
      </div>
      <div className="who">Designli · {ownerName}</div>
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
        <UsageLine />
        <DeckLine />
        <SourceHealthList health={health} />
        <Link href="/semana" className="nav foot" aria-current={path.startsWith("/semana") ? "page" : undefined}>
          Hecho hoy <b>{counts.doneToday}</b>
        </Link>
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
