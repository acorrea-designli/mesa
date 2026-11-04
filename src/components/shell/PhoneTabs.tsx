"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Counts } from "@/lib/domain/types";
import { LineStub } from "../line/Line";
import { isActive, NAV } from "./Rail";

/** Phone bottom tab bar (replaces the rail at <= 720px): each tab is a line stub at 30% that goes full ink when active. */
export function PhoneTabs({ counts }: { counts: Counts }) {
  const path = usePathname();
  return (
    <nav className="ph-tabs" aria-label="Navegación">
      {NAV.map((n) => {
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
    </nav>
  );
}
