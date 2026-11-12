"use client";
// "Revisar PDF" in the ticket header (t135): always visible while the ticket has a PDF. One PDF links straight to
// its review view; several open a small chooser.
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { Attachment } from "@/lib/domain/types";
import { IcCheck, IcFile } from "@/features/salidas/icons";

const reviewHref = (ticketId: string, a: Attachment) => `/tickets/${encodeURIComponent(ticketId)}/pdf/${encodeURIComponent(a.id)}`;

export function ReviewPdf({ ticketId, pdfs }: { ticketId: string; pdfs: Attachment[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menu = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      box.current?.querySelector<HTMLElement>("button")?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const only = pdfs[0];
  if (!only) return null;
  if (pdfs.length === 1)
    return (
      <div className="tk-revpdf">
        <Link className="btn sm" href={reviewHref(ticketId, only)} aria-label={`Revisar PDF: ${only.filename}`}>
          <IcFile />
          Revisar PDF
        </Link>
      </div>
    );
  return (
    <div className="tk-revpdf" ref={box}>
      <button className="btn sm" type="button" aria-expanded={open} aria-controls={menu} onClick={() => setOpen((o) => !o)}>
        <IcFile />
        Revisar PDF
        <small>{pdfs.length}</small>
      </button>
      {open ? (
        <div className="tk-revpdf-pop" id={menu} role="group" aria-label="Elige un PDF para revisar">
          {pdfs.map((a) => (
            <Link key={a.id} href={reviewHref(ticketId, a)} onClick={() => setOpen(false)} title={a.filename}>
              <span>{a.filename}</span>
              {a.reviewedAt ? (
                <small>
                  <IcCheck width={11} height={11} /> Terminado
                </small>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
