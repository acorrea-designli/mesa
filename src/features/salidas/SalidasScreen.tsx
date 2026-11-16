"use client";
// Salidas B: a free-order queue strip above one card. Any item opens on click;
// J/K or arrows move without acting; every action is a button on the card.
// Deciding opens the next undecided item.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Mark } from "@/lib/domain/types";
import { useArrive, usePress } from "@/lib/motion";
import { salidaApi } from "./api";
import { Historial } from "./Historial";
import { IcClock } from "./icons";
import { ago, destShort, rowLine, sourceLabel, sourceVar, stripStatus, undoOpen } from "./model";
import { cx } from "./parts";
import { SalidaCard } from "./SalidaCard";
import { useLiveRefresh, useNow } from "./live";
import type { SalidaView, SalidasData } from "./types";

const UNDECIDED = new Set(["pending"]);
const isDecided = (s: SalidaView) => ["sent", "denied", "expired", "deleted", "withdrawn"].includes(s.status);

/** The card that opens by default: the newest pending one (the strip is newest first), else the newest undecided, else the first. */
const defaultOpen = (items: SalidaView[]) => (items.find((s) => UNDECIDED.has(s.status)) ?? items.find((s) => !isDecided(s)) ?? items[0])?.id ?? null;

/** Put `?s=<id>` in the address bar (no navigation); null removes it. */
function setUrlSalida(id: string | null) {
  const u = new URL(window.location.href);
  if (id) u.searchParams.set("s", id);
  else u.searchParams.delete("s");
  window.history.replaceState(null, "", u);
}

export function SalidasScreen({ data, initial }: { data: SalidasData; initial?: string }) {
  const refresh = useLiveRefresh();
  const [order, setOrder] = useState<string[]>(() => data.items.map((s) => s.id));
  const [denied, setDenied] = useState<Set<string>>(() => new Set());
  const inStrip = Boolean(initial && data.items.some((s) => s.id === initial));
  const [openId, setOpenId] = useState<string | null>(() => (inStrip ? (initial ?? null) : defaultOpen(data.items)));
  // t204: the Historial panel. A `?s=` that is not in the strip opens through it, with its card (or a notice when it does not exist).
  const [panel, setPanel] = useState<"queue" | "history">(() => (initial && !inStrip ? "history" : "queue"));
  const [hOpen, setHOpen] = useState<string | null>(() => (initial && !inStrip && data.focus ? initial : null));
  const [fetched, setFetched] = useState<SalidaView | null>(data.focus);
  const [hError, setHError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(data.missing);
  const [marks, setMarksMap] = useState<Record<string, Mark[]>>({});
  const anySending = data.items.some((s) => s.status === "sending");
  const now = useNow(data.now, true, anySending ? 250 : 1000);

  // Keep the client order; an item new from the server is newer than every one here, so it goes first.
  const ids = data.items.map((s) => s.id).join(",");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder((o) => [...data.items.filter((s) => !o.includes(s.id)).map((s) => s.id), ...o.filter((id) => data.items.some((s) => s.id === id))]);
  }, [ids, data.items]);

  const byId = useMemo(() => new Map(data.items.map((s) => [s.id, s])), [data.items]);
  const items = order.map((id) => byId.get(id)).filter((s): s is SalidaView => Boolean(s));
  const open = byId.get(openId ?? "") ?? byId.get(defaultOpen(items) ?? "");
  const isUndecided = (s: SalidaView) => s.status === "pending" && !denied.has(s.id);

  const counts = {
    pending: items.filter(isUndecided).length,
    scheduled: items.filter((s) => s.status === "scheduled").length,
    queued: items.filter((s) => s.status === "queued_until_back" && s.holdKind !== "lead").length,
    held: items.filter((s) => s.status === "queued_until_back" && s.holdKind === "lead").length,
    drafted: items.filter((s) => s.status === "draft_created").length,
    draftedBc: items.filter((s) => s.status === "draft_created" && s.source === "basecamp").length,
  };

  const select = useCallback((id: string) => {
    setOpenId(id);
    setUrlSalida(id);
  }, []);

  // The salida open in the Historial: the strip's copy when it has come back to the strip (a retry), else the fetched one.
  const hView = hOpen ? (byId.get(hOpen) ?? (fetched?.id === hOpen ? fetched : null)) : null;
  const fetchedAt = useRef<string | null>(data.focus ? data.now : null);
  useEffect(() => {
    if (!hOpen || byId.has(hOpen)) return;
    if (fetched?.id === hOpen && fetchedAt.current === data.now) return;
    let live = true;
    fetchedAt.current = data.now;
    salidaApi
      .view(hOpen)
      .then((v) => {
        if (!live) return;
        setFetched(v);
        setHError(null);
      })
      .catch((e: unknown) => live && setHError(e instanceof Error ? e.message : "No se pudo abrir la salida"));
    return () => {
      live = false;
    };
  }, [hOpen, data.now, byId, fetched]);

  const openHistory = useCallback(() => {
    setPanel("history");
    setHOpen(null);
    setHError(null);
    setMissing(null);
    setUrlSalida(null);
  }, []);
  const openFromHistory = useCallback((id: string) => {
    setHOpen(id);
    setHError(null);
    setMissing(null);
    setUrlSalida(id);
  }, []);
  const backToQueue = useCallback(() => {
    setPanel("queue");
    setHOpen(null);
    setMissing(null);
    setUrlSalida(openId && byId.has(openId) ? openId : null);
  }, [openId, byId]);

  const openNext = useCallback(
    (from: string) => {
      const i = items.findIndex((s) => s.id === from);
      for (let k = 1; k <= items.length; k++) {
        const s = items[(i + k) % items.length];
        if (s && s.id !== from && isUndecided(s)) return select(s.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, select, denied],
  );

  // After the undo window ends on the open card, the next pending item opens.
  const watching = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    if (open.status === "sending" && undoOpen(open, now)) watching.current = open.id;
    else if (watching.current === open.id && open.status === "sending") {
      watching.current = null;
      openNext(open.id);
    }
  }, [open, now, openNext]);

  const skip = useCallback(() => {
    if (!open) return;
    const id = open.id;
    setOrder((o) => [...o.filter((x) => x !== id), id]);
    openNext(id);
  }, [open, openNext]);

  const move = useCallback(
    (d: number) => {
      if (!items.length) return;
      const i = Math.max(0, items.findIndex((s) => s.id === open?.id));
      const next = items[(i + d + items.length) % items.length];
      if (next) select(next.id);
    },
    [items, open, select],
  );

  // Navigation keys only; never while typing, never with modifiers, never while the semáforo toolbar is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || t.closest("[data-sema],[role=dialog],[role=menu]"))) return;
      if (document.querySelector(".sm-float")) return;
      if (panel === "history") return;
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowRight") return e.preventDefault(), move(1);
      if (k === "k" || e.key === "ArrowLeft") return e.preventDefault(), move(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [move, panel]);

  const listRef = useArrive<HTMLDivElement>(".sa-qi");
  const pressRef = usePress<HTMLDivElement>(".sa-qi", true);
  const markId = panel === "history" ? hOpen : (open?.id ?? null);
  const setMarks = useCallback((m: Mark[]) => markId && setMarksMap((x) => ({ ...x, [markId]: m })), [markId]);

  const counter = [
    `${counts.pending} ${counts.pending === 1 ? "pendiente" : "pendientes"}`,
    counts.scheduled ? `${counts.scheduled} ${counts.scheduled === 1 ? "programada" : "programadas"}` : "",
    counts.queued ? `${counts.queued} al volver` : "",
    counts.held ? `${counts.held} en espera` : "",
    counts.drafted - counts.draftedBc ? `${counts.drafted - counts.draftedBc} ${counts.drafted - counts.draftedBc === 1 ? "borrador en Slack" : "borradores en Slack"}` : "",
    counts.draftedBc ? `${counts.draftedBc} ${counts.draftedBc === 1 ? "borrador en Basecamp" : "borradores en Basecamp"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const history = panel === "history";
  return (
    <div className="sa-one">
      <div className="sa-head">
        <h1>
          Salidas<span>Nada sale sin tu firma</span>
        </h1>
        <div className="sa-headr">
          {history ? null : <span className="sort sa-keys">J/K o ←/→ moverse</span>}
          <button type="button" className="btn sa-histbtn" aria-pressed={history} onClick={history ? backToQueue : openHistory}>
            {history ? "Volver a la cola" : "Historial"}
          </button>
        </div>
      </div>
      {history ? (
        <>
          {hOpen ? (
            <div className="sa-hback">
              <button type="button" className="btn" onClick={openHistory}>
                ← Historial
              </button>
              <button type="button" className="btn" onClick={backToQueue}>
                Ir a la cola
              </button>
            </div>
          ) : null}
          {missing ? (
            <div className="sa-hist-note sa-hist-missing" role="alert">
              No existe ninguna salida con el id {missing}. Búscala en el historial.
            </div>
          ) : null}
          {hOpen && hView ? (
            <SalidaCard
              key={hView.id}
              view={hView}
              chips={data.chips}
              now={now}
              marks={marks[hView.id] ?? []}
              setMarks={setMarks}
              onChanged={refresh}
              onDecided={() => {}}
              onUndecided={() => {}}
            />
          ) : null}
          {hOpen && !hView ? (
            <div className="sa-hist-note" role={hError ? "alert" : undefined}>
              {hError ? `No se pudo abrir la salida: ${hError}` : "Abriendo la salida…"}
            </div>
          ) : null}
          <Historial refreshKey={data.now} now={now} hidden={Boolean(hOpen)} onOpen={openFromHistory} />
        </>
      ) : items.length ? (
        <>
          <div className="sa-q">
            <div className="sa-qh">
              <b>{counter}</b>
              <span>Más nuevas primero. Abre la que quieras; saltar no decide nada.</span>
            </div>
            <div
              className="sa-ql"
              role="list"
              aria-label="Salidas, de la más nueva a la más vieja"
              ref={(el) => {
                listRef.current = el;
                pressRef.current = el;
              }}
            >
              {items.map((s) => (
                <QueueItem
                  key={s.id}
                  s={s}
                  now={now}
                  current={s.id === open?.id}
                  denied={denied.has(s.id)}
                  onOpen={() => select(s.id)}
                  onSwipe={() => {
                    if (s.id === open?.id) skip();
                  }}
                />
              ))}
            </div>
          </div>
          {open ? (
            <SalidaCard
              key={open.id}
              view={open}
              chips={data.chips}
              now={now}
              marks={marks[open.id] ?? []}
              setMarks={setMarks}
              onChanged={refresh}
              onDecided={(id) => {
                setDenied((d) => new Set(d).add(id));
                window.setTimeout(() => setDenied((d) => (d.delete(id), new Set(d))), 6000);
                openNext(id);
              }}
              onUndecided={(id) => {
                setDenied((d) => (d.delete(id), new Set(d)));
                select(id);
              }}
              onSkip={items.filter(isUndecided).length > 1 ? skip : undefined}
            />
          ) : null}
        </>
      ) : (
        <div className="sa-blank">
          <h2>Nada por firmar</h2>
          <p>Cuando Claude proponga un mensaje para Slack, Basecamp o GitHub aparece aquí con su destino y su texto exactos. Lo de días anteriores está en el Historial.</p>
        </div>
      )}
    </div>
  );
}

function QueueItem({ s, now, current, denied, onOpen, onSwipe }: { s: SalidaView; now: number; current: boolean; denied: boolean; onOpen: () => void; onSwipe: () => void }) {
  const startX = useRef<number | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);
  const body = s.versions.find((v) => v.n === s.currentVersion)?.body ?? "";
  const decided = denied || isDecided(s);
  const color = sourceVar(s.source);
  return (
    <button
      ref={ref}
      type="button"
      role="listitem"
      className={cx("sa-qi", decided && "done", s.status === "scheduled" && "sched", s.status === "sending" && "going", s.status === "queued_until_back" && "queued", s.status === "draft_created" && "drafted")}
      style={{ ["--c" as string]: color }}
      aria-current={current ? "true" : undefined}
      onClick={onOpen}
      onTouchStart={(e) => (startX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const x = e.changedTouches[0]?.clientX;
        if (startX.current != null && x != null && x - startX.current < -60) onSwipe();
        startX.current = null;
      }}
    >
      <span className="o">
        <i />
        {sourceLabel(s.source)}
        <span className="a">{ago(s.createdAt, now)}</span>
      </span>
      <span className="d">{destShort(s.destination)}</span>
      <span className="x">{rowLine(s.source, s.destination, body)}</span>
      <span className="s">
        {s.status === "scheduled" ? <IcClock /> : null}
        {denied ? "Denegada" : stripStatus(s, now)}
      </span>
    </button>
  );
}
