"use client";
// Salidas B: a free-order queue strip above one card. Any item opens on click;
// J/K or arrows move without acting; every action is a button on the card.
// Deciding opens the next undecided item.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Mark } from "@/lib/domain/types";
import { isSimulated } from "@/lib/domain/sandbox";
import { useArrive, usePress } from "@/lib/motion";
import { IcClock } from "./icons";
import { ago, calendarLine, destShort, firstLine, hhmm, sourceLabel, undoOpen, whenLabel } from "./model";
import { cx } from "./parts";
import { SalidaCard } from "./SalidaCard";
import { useLiveRefresh, useNow } from "./live";
import type { SalidaView, SalidasData } from "./types";

const UNDECIDED = new Set(["pending"]);
const isDecided = (s: SalidaView) => ["sent", "denied", "expired", "deleted", "withdrawn"].includes(s.status);

function stripStatus(s: SalidaView, now: number): string {
  switch (s.status) {
    case "pending":
      return s.expiresAt ? `caduca ${hhmm(s.expiresAt)}` : "sin caducidad";
    case "scheduled":
      return s.sendAt ? `Sale ${whenLabel(s.sendAt, new Date(now))}` : "Programada";
    case "sending":
      return undoOpen(s, now) ? "Enviando…" : "Saliendo…";
    case "queued_until_back":
      return `Al volver ${sourceLabel(s.source)}`;
    case "draft_created":
      return "Borrador en Slack · envíalo tú";
    case "sent":
      return isSimulated(s) ? "Simulado · no salió" : `Enviada ${hhmm(s.sentAt)}`;
    case "deleted":
      return "Eliminada";
    case "denied":
      return "Denegada";
    case "expired":
      return "Caducada";
    case "withdrawn":
      return "Retirada";
    case "failed":
      return "Falló";
    default:
      return s.status;
  }
}

export function SalidasScreen({ data, initial }: { data: SalidasData; initial?: string }) {
  const refresh = useLiveRefresh();
  const [order, setOrder] = useState<string[]>(() => data.items.map((s) => s.id));
  const [denied, setDenied] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(() => {
    if (initial && data.items.some((s) => s.id === initial)) return initial;
    return (data.items.find((s) => UNDECIDED.has(s.status)) ?? data.items.find((s) => !isDecided(s)) ?? data.items[0])?.id ?? null;
  });
  const [marks, setMarksMap] = useState<Record<string, Mark[]>>({});
  const anySending = data.items.some((s) => s.status === "sending");
  const now = useNow(data.now, true, anySending ? 250 : 1000);

  // Keep the client order, appending new items from the server.
  const ids = data.items.map((s) => s.id).join(",");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder((o) => [...o.filter((id) => data.items.some((s) => s.id === id)), ...data.items.filter((s) => !o.includes(s.id)).map((s) => s.id)]);
  }, [ids, data.items]);

  const byId = useMemo(() => new Map(data.items.map((s) => [s.id, s])), [data.items]);
  const items = order.map((id) => byId.get(id)).filter((s): s is SalidaView => Boolean(s));
  const open = openId ? byId.get(openId) : undefined;
  const isUndecided = (s: SalidaView) => s.status === "pending" && !denied.has(s.id);

  const counts = {
    pending: items.filter(isUndecided).length,
    scheduled: items.filter((s) => s.status === "scheduled").length,
    queued: items.filter((s) => s.status === "queued_until_back").length,
    drafted: items.filter((s) => s.status === "draft_created").length,
  };

  const select = useCallback((id: string) => {
    setOpenId(id);
    const u = new URL(window.location.href);
    u.searchParams.set("s", id);
    window.history.replaceState(null, "", u);
  }, []);

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
    if (!openId) return;
    setOrder((o) => [...o.filter((x) => x !== openId), openId]);
    openNext(openId);
  }, [openId, openNext]);

  const move = useCallback(
    (d: number) => {
      if (!items.length) return;
      const i = Math.max(0, items.findIndex((s) => s.id === openId));
      const next = items[(i + d + items.length) % items.length];
      if (next) select(next.id);
    },
    [items, openId, select],
  );

  // Navigation keys only; never while typing, never with modifiers, never while the semáforo toolbar is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || t.closest("[data-sema],[role=dialog],[role=menu]"))) return;
      if (document.querySelector(".sm-float")) return;
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowRight") return e.preventDefault(), move(1);
      if (k === "k" || e.key === "ArrowLeft") return e.preventDefault(), move(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [move]);

  const listRef = useArrive<HTMLDivElement>(".sa-qi");
  const pressRef = usePress<HTMLDivElement>(".sa-qi", true);
  const setMarks = useCallback((m: Mark[]) => openId && setMarksMap((x) => ({ ...x, [openId]: m })), [openId]);

  const counter = [
    `${counts.pending} ${counts.pending === 1 ? "pendiente" : "pendientes"}`,
    counts.scheduled ? `${counts.scheduled} ${counts.scheduled === 1 ? "programada" : "programadas"}` : "",
    counts.queued ? `${counts.queued} al volver` : "",
    counts.drafted ? `${counts.drafted} ${counts.drafted === 1 ? "borrador en Slack" : "borradores en Slack"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="sa-one">
      <div className="sa-head">
        <h1>
          Salidas<span>Nada sale sin tu firma</span>
        </h1>
        <span className="sort sa-keys">J/K o ←/→ moverse</span>
      </div>
      {items.length ? (
        <>
          <div className="sa-q">
            <div className="sa-qh">
              <b>{counter}</b>
              <span>Abre la que quieras; saltar no decide nada.</span>
            </div>
            <div
              className="sa-ql"
              role="list"
              aria-label="Salidas, en cualquier orden"
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
                  current={s.id === openId}
                  denied={denied.has(s.id)}
                  onOpen={() => select(s.id)}
                  onSwipe={() => {
                    if (s.id === openId) skip();
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
          <p>Cuando Claude proponga un mensaje para Slack, Basecamp o GitHub aparece aquí con su destino y su texto exactos.</p>
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
  const body = s.versions.find((v) => v.n === s.currentVersion)?.body || (s.destination.kind === "github_review" ? (s.destination.comments?.[0]?.body ?? "Aprobación sin comentario") : "");
  const decided = denied || isDecided(s);
  const color = s.source === "slack" ? "var(--sl)" : s.source === "basecamp" ? "var(--bc)" : s.source === "calendar" ? "var(--ca)" : "var(--gh)";
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
      <span className="x">{s.source === "calendar" ? calendarLine(body) : firstLine(body)}</span>
      <span className="s">
        {s.status === "scheduled" ? <IcClock /> : null}
        {denied ? "Denegada" : stripStatus(s, now)}
      </span>
    </button>
  );
}
