"use client";
// Ticket text with its addresses and ticket refs as links. React elements only (no HTML is ever
// injected): the segments come from src/lib/domain/links.ts, which decides what is safe to open.
import Link from "next/link";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { srcClass } from "@/components/ui/primitives";
import { middleTruncate, tokenize } from "@/lib/domain/links";

/** Refs of the tickets that exist: a "t49" in the text links only when it is in here. */
export const KnownTickets = createContext<ReadonlySet<string>>(new Set());

/** inButton: the text sits inside a button (an option): a click on a link opens it and does not press the button. */
export function Linked({ text, inButton }: { text: string; inButton?: boolean }): ReactNode {
  const tickets = useContext(KnownTickets);
  const segs = useMemo(() => tokenize(text, tickets), [text, tickets]);
  return (
    <>
      {segs.map((s, i) =>
        s.t === "text" ? (
          s.v
        ) : s.t === "ticket" ? (
          <Link key={i} className="tk-link ref" href={`/tickets?t=${s.ref}`} onClick={inButton ? (e) => e.stopPropagation() : undefined}>
            {s.v}
          </Link>
        ) : (
          <a key={i} className={["tk-link", srcClass(s.link.source)].filter(Boolean).join(" ")} href={s.link.href} target="_blank" rel="noopener noreferrer" title={s.link.href} onClick={inButton ? (e) => e.stopPropagation() : undefined}>
            {s.link.label ?? middleTruncate(s.v)}
          </a>
        ),
      )}
    </>
  );
}
