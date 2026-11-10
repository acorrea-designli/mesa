"use client";
// The deck panel: every PR the Stream Deck key counts, the deck's reason, and whether it matters by Mesa's rules.
// Mounted once in AppShell. It asks GET /api/deck?detail=1 each time it opens (that is where the GitHub reads happen;
// the rail's polling never does), and a failed or rate-limited read says "sin dato" instead of a verdict.
import { useEffect, useState } from "react";
import type { DeckPrView, DeckVerdict } from "@/lib/domain/deck";
import { Sheet } from "@/components/ui/interactive";
import { closeDeckPanel, useDeckPanelOpen } from "./panel";
import "./deck.css";

interface Detail {
  view: { state: "none" | "fresh" | "stale"; total: number | null; age: string };
  prs: DeckPrView[];
}

const VERDICT: Record<DeckVerdict, string> = { interesa: "Nos interesa", no_interesa: "No nos interesa", sin_dato: "Sin dato" };

/** "El deck cuenta 2: 1 nos interesa, 1 no." */
export function summary(total: number | null, prs: readonly DeckPrView[]): string {
  if (total === null) return "El deck no tiene dato todavía.";
  const yes = prs.filter((p) => p.verdict === "interesa").length;
  const no = prs.filter((p) => p.verdict === "no_interesa").length;
  const unknown = prs.filter((p) => p.verdict === "sin_dato").length;
  const parts = [`${yes} ${yes === 1 ? "nos interesa" : "nos interesan"}`, `${no} no`];
  if (unknown) parts.push(`${unknown} sin dato`);
  return `El deck cuenta ${total}: ${parts.join(", ")}.`;
}

export function DeckPrRow({ p }: { p: DeckPrView }) {
  return (
    <li className={`dk-pr ${p.verdict}`}>
      <div className="dk-ref">
        <a href={p.url || undefined} target="_blank" rel="noopener noreferrer">
          {p.repo.split("/")[1] ?? p.repo}
          {p.num !== null ? `#${p.num}` : ""}
        </a>
        <small>{p.author}</small>
      </div>
      <p className="dk-title">{p.title}</p>
      <p className="dk-line">
        <span className="k">El deck la cuenta</span> {p.reason}
      </p>
      <p className="dk-line dk-verdict">
        <b>{VERDICT[p.verdict]}</b> · {p.why}
      </p>
      {p.disagree ? <p className="dk-line dk-diff">{p.disagree}</p> : null}
      {p.mesa ? <p className="dk-line">{p.mesa}</p> : null}
    </li>
  );
}

/** Mounted only while the sheet is open, so every opening starts from "Leyendo" and reads GitHub afresh. */
function DeckPanelBody() {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 45_000);
    void (async () => {
      try {
        const r = await fetch("/api/deck?detail=1", { cache: "no-store", signal: ctl.signal });
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as Detail;
        if (alive) setDetail(body);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, []);

  return (
    <div className="dk-panel">
      {failed ? (
        <p className="dk-note">Sin dato: no se pudo leer el estado del deck.</p>
      ) : !detail ? (
        <p className="dk-note" role="status">
          Leyendo GitHub…
        </p>
      ) : (
        <>
          <p className="dk-sum">{summary(detail.view.total, detail.prs)}</p>
          {detail.view.state === "stale" ? <p className="dk-note">El deck no se actualiza desde {detail.view.age}: puede estar desfasado.</p> : null}
          {detail.view.state === "none" ? <p className="dk-note">No hay estado del deck (gh-watch no ha escrito su archivo).</p> : null}
          {detail.prs.length ? (
            <ul className="dk-list">
              {detail.prs.map((p) => (
                <DeckPrRow key={p.key} p={p} />
              ))}
            </ul>
          ) : detail.view.state !== "none" ? (
            <p className="dk-note">El deck no lista ninguna PR.</p>
          ) : null}
        </>
      )}
    </div>
  );
}

export function DeckPanel() {
  const open = useDeckPanelOpen();
  return (
    <Sheet open={open} onClose={closeDeckPanel} title="PRs pendientes de review">
      <DeckPanelBody />
    </Sheet>
  );
}
