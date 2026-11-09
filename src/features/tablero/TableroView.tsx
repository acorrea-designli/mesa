"use client";
// Tablero B: one lane per source (its line runs behind its cards), five station
// columns. Drag a card between columns, or use "Mover" (bottom sheet on the phone).
// A move writes the station to SQLite; the card shows "Sin sincronizar" until lane C
// acks the GitHub Project write.
// Batch: a checkbox per card (Shift+click ranges, Ctrl/Cmd+click toggles, long-press on the
// phone), "Seleccionar carril" / "Seleccionar estación", Esc clears; the batch bar moves,
// hands to Claude or ignores the whole selection with one toast and one Deshacer.
// "Dárselo a Claude" (one card or the selection) opens a linked ticket for the lead; the card
// then shows its owner agent ("tl-t21 · En curso", "Claude · por asignar"), live over SSE.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BrokenLine, SourceDot } from "@/components/line/Line";
import { Alert, Btn, FilesBadge, LinkChip, StatusTag } from "@/components/ui/primitives";
import { Sheet, Tabs, useToast } from "@/components/ui/interactive";
import { SOURCE_LABEL, STATION_LABEL, STATIONS, type Source, type Station } from "@/lib/domain/types";
import { confirmPick, useArrive, useLift, usePress } from "@/lib/motion";
import { useLive } from "../hoy/useLive";
import type { TableroData } from "./data";
import {
  applyMove,
  canDispatch,
  capCell,
  groupBoard,
  ignoreTargets,
  isQuiet,
  LANE_NOTE,
  LANES,
  laneCounts,
  rangeIds,
  selectGroup,
  stationCounts,
  stationIds,
  toggleId,
  type Card,
} from "./model";
import { cardsLabel, dispatchToast, tableroApi, type StationMove } from "./api";
import { BatchBar } from "./BatchBar";
import { NewTaskSheet } from "./NewTask";
import { MoreButton, useActionMenu, type MenuAction } from "../ignore/ActionMenu";
import { ignoreLabel } from "../ignore/model";
import { useIgnore } from "../ignore/useIgnore";
import "../ignore/ignore.css";
import "./tablero.css";
import "./batch.css";

const LANE_VAR: Record<Source, string> = { github: "var(--gh)", slack: "var(--sl)", claude: "var(--cl)", basecamp: "var(--bc)" };
const DONE_CAP = 4;

/** Card stub: the lane's line, or line-ring-line when the card links two sources (interchange). */
function Mark({ c }: { c: Card }) {
  const other = c.sources.find((s) => s !== c.lane);
  if (!other) return <span className={`ln src-${c.lane}`} aria-hidden="true" />;
  return (
    <span className="tb-mark" role="img" aria-label={`Enlazada con ${SOURCE_LABEL[other]}`}>
      <span className={`ln src-${c.lane}`} />
      <span className="ring" />
      <span className={`ln src-${other}`} />
    </span>
  );
}

interface CardMenu {
  onMore: (el: HTMLElement) => void;
  onContext: React.MouseEventHandler<HTMLElement>;
}

/** Click modifiers the selection reads (a checkbox click, a card click, a keyboard toggle). */
type Mods = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };

const INTERACTIVE = "button, a, input, label, select, textarea";

function OwnerLink({ c }: { c: Card }) {
  if (!c.owner) return null;
  return (
    <Link className={c.owner.unassigned ? "lk src-claude tb-owner is-open" : "lk src-claude tb-owner"} href={c.owner.href} aria-label={`Ticket ${c.owner.ticketRef}: ${c.owner.label}`}>
      {/* The agent name carries the ref (tl-t21); "Claude · por asignar" needs it spelled out. */}
      {c.owner.label.includes(c.owner.ticketRef) ? null : <span className="tb-owner-ref">{c.owner.ticketRef}</span>}
      {c.owner.label}
    </Link>
  );
}

function CardView({
  c,
  onMove,
  draggable,
  menu,
  selected,
  selecting,
  onPick,
  syncOff = false,
}: {
  c: Card;
  onMove: (c: Card) => void;
  draggable: boolean;
  menu?: CardMenu;
  selected: boolean;
  selecting: boolean;
  onPick: (e: Mods, c: Card) => void;
  /** Sandbox: GitHub is off, so no card carries a sync flag. */
  syncOff?: boolean;
}) {
  const done = c.station === "done";
  const ref = useLift<HTMLElement>(selected);
  const showWait = c.wait && !(c.owner && c.wait.tone === "cl");
  return (
    <article
      ref={ref}
      data-card={c.id}
      className={["tb-card", done && "done", selected && "is-sel"].filter(Boolean).join(" ")}
      onContextMenu={menu?.onContext}
      draggable={draggable}
      onMouseDown={(e) => {
        // Shift+click selects a range: do not start a text selection.
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        if (e.shiftKey || e.ctrlKey || e.metaKey || selecting) onPick(e, c);
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/mesa-task", c.id);
        e.dataTransfer.effectAllowed = "move";
        e.currentTarget.classList.add("is-drag");
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove("is-drag")}
    >
      <div className="tb-top">
        <span className="tb-slot">
          <span className="tb-pick">
            <input type="checkbox" checked={selected} aria-label={`Seleccionar «${c.title}»`} onChange={() => undefined} onClick={(e) => onPick(e, c)} />
            <span className="tb-box" aria-hidden="true" />
          </span>
          <span className="tb-stub">
            <Mark c={c} />
          </span>
        </span>
        <span className="tb-proj">{c.project}</span>
        <time>{c.time}</time>
        <button type="button" className="tb-mv" aria-label={`Mover «${c.title}»`} onClick={() => onMove(c)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 7h10M9 4l3 3-3 3" />
          </svg>
        </button>
        {menu ? <MoreButton className="tb-more-btn" label={`Más acciones: ${c.title}`} onOpen={menu.onMore} /> : null}
      </div>
      <h2 className="tb-t">{c.title}</h2>
      {done ? null : (
        <div className="tb-foot">
          <FilesBadge chip={c.files} />
          {c.chips.map((x) => (
            <LinkChip key={x.label} source={x.source} href={x.url ?? undefined}>
              {x.label}
            </LinkChip>
          ))}
          <OwnerLink c={c} />
          {showWait && c.wait ? <StatusTag tone={c.wait.tone}>{c.wait.label}</StatusTag> : null}
          {!syncOff && c.syncState !== "synced" ? <StatusTag tone="off">{c.syncState === "error" ? "Sin sincronizar · error" : "Sin sincronizar"}</StatusTag> : null}
        </div>
      )}
    </article>
  );
}

function SyncStatus({ s, sandbox }: { s: TableroData["sync"]; sandbox: boolean }) {
  if (sandbox) return <span className="tb-sync">GitHub apagado en sandbox</span>;
  if (s.state === "error")
    return (
      <span className="tb-sync" role="status">
        <BrokenLine source="github" width={28} title="Sin sincronizar" />
        <span>
          <b>Sin sincronizar</b>
          {s.lastOkLabel ? ` · último ok ${s.lastOkLabel}` : ""}
        </span>
      </span>
    );
  if (s.state === "syncing")
    return (
      <span className="tb-sync" role="status">
        <svg width="40" height="12" viewBox="0 0 40 12" aria-hidden="true">
          <path d="M3 6H37" stroke="var(--gh)" strokeWidth="4" strokeLinecap="round" opacity=".38" />
          <circle cx="8" cy="6" r="4" className="tb-sync-dot f-gh" stroke="var(--ink)" strokeWidth="1.4" />
        </svg>
        <span>
          Sincronizando con GitHub Project · <b>{s.synced} de {s.total}</b>
        </span>
      </span>
    );
  if (s.state === "empty") return <span className="tb-sync">GitHub Project sin tarjetas todavía</span>;
  return (
    <span className="tb-sync" role="status">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 7.5l3 3 6-7" />
      </svg>
      <span>
        Sincronizado con GitHub Project · <b>{s.agoLabel ?? "ahora"}</b>
      </span>
    </span>
  );
}

const LONG_PRESS_MS = 450;
const OPEN_STATIONS = STATIONS.filter((st) => st !== "done");

export function TableroView({ data }: { data: TableroData }) {
  useLive();
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<Source | "all">("all");
  const [query, setQuery] = useState("");
  const [local, setLocal] = useState<Record<string, Station>>({});
  const [moving, setMoving] = useState<Card | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [phoneStation, setPhoneStation] = useState<Station>("inbox");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const anchor = useRef<string | null>(null);

  // Local moves win until the server shows the same station.
  const cards = useMemo(() => {
    let cs = data.cards;
    for (const [id, st] of Object.entries(local)) {
      const server = cs.find((c) => c.id === id);
      if (server && server.station !== st) cs = applyMove(cs, id, st);
    }
    return cs;
  }, [data.cards, local]);

  // Forget local moves the server already shows, so a later move made elsewhere is not hidden
  // (adjusted while rendering when new server data arrives, not in an effect).
  const [seen, setSeen] = useState(data.cards);
  if (seen !== data.cards) {
    setSeen(data.cards);
    const keep = Object.entries(local).filter(([id, st]) => data.cards.find((c) => c.id === id)?.station !== st);
    if (keep.length !== Object.keys(local).length) setLocal(Object.fromEntries(keep));
  }

  const grid = useMemo(() => groupBoard(cards, filter, query), [cards, filter, query]);
  const all = useMemo(() => groupBoard(cards, "all", query), [cards, query]);
  const counts = useMemo(() => stationCounts(cards), [cards]);
  const lanes = useMemo(() => laneCounts(cards), [cards]);
  const boardRef = useArrive<HTMLDivElement>(".tb-card", `${filter}:${query}`);
  const pressRef = usePress<HTMLDivElement>(".tb-card", true);
  const menu = useActionMenu();
  const { ignore, ignoreMany } = useIgnore();

  // ---------- selection ----------
  const selCards = useMemo(() => cards.filter((c) => sel.has(c.id)), [cards, sel]);
  const selecting = selCards.length > 0;
  const clear = useCallback(() => {
    setSel(new Set());
    anchor.current = null;
  }, []);

  /** Shift: range from the anchor in the board's reading order; otherwise toggle one card. */
  const pick = useCallback((e: Mods, c: Card, scope: ParentNode | null) => {
    if (e.shiftKey && anchor.current) {
      const order = [...(scope ?? document).querySelectorAll<HTMLElement>("[data-card]")].map((el) => ({ id: el.dataset.card ?? "" }));
      const ids = rangeIds(order, anchor.current, c.id);
      setSel((s) => new Set([...s, ...ids]));
      return;
    }
    setSel((s) => toggleId(s, c.id));
    anchor.current = c.id;
  }, []);
  const pickDesk = useCallback((e: Mods, c: Card) => pick(e, c, document.querySelector(".tb-grid")), [pick]);
  const pickPhone = useCallback((e: Mods, c: Card) => pick(e, c, document.querySelector(".tb-ph-lanes")), [pick]);
  const group = (ids: string[]) => setSel((s) => selectGroup(s, ids));

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || moving || newOpen || menu.open) return;
      clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting, moving, newOpen, menu.open, clear]);

  // ---------- actions ----------
  const forget = (ids: string[]) =>
    setLocal((m) => {
      const n = { ...m };
      for (const id of ids) delete n[id];
      return n;
    });

  const move = async (c: Card, station: Station) => {
    if (c.station === station) return;
    setLocal((m) => ({ ...m, [c.id]: station }));
    try {
      await tableroApi.move(c.id, station);
      toast({ text: `«${c.title}» a ${STATION_LABEL[station]}${data.sandbox ? "" : " · Sin sincronizar hasta que GitHub confirme"}` });
      router.refresh();
    } catch {
      forget([c.id]);
      toast({ text: "No se pudo mover la tarjeta" });
    }
  };

  const undoMoves = async (previous: StationMove[]) => {
    setLocal((m) => ({ ...m, ...Object.fromEntries(previous.map((p) => [p.id, p.station])) }));
    try {
      await tableroApi.restore(previous);
      toast({ text: `Deshecho · ${cardsLabel(previous.length)} de vuelta` });
      router.refresh();
    } catch {
      forget(previous.map((p) => p.id));
      toast({ text: "No se pudo deshacer" });
      router.refresh();
    }
  };

  const moveMany = async (ids: string[], station: Station) => {
    if (!ids.length) return;
    setBusy(true);
    setLocal((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, station])) }));
    clear();
    try {
      const r = await tableroApi.moveMany(ids, station);
      toast({
        text: `${cardsLabel(ids.length)} a ${STATION_LABEL[station]}${data.sandbox ? "" : " · Sin sincronizar hasta que GitHub confirme"}`,
        duration: 8000,
        action: { label: "Deshacer", onClick: () => void undoMoves(r.previous) },
      });
      router.refresh();
    } catch {
      forget(ids);
      toast({ text: "No se pudieron mover las tarjetas" });
    } finally {
      setBusy(false);
    }
  };

  const dispatchOne = async (c: Card) => {
    try {
      const r = await tableroApi.dispatch(c.id);
      toast({ text: r.created ? `«${c.title}» para Claude · ${r.ticket.ref}` : `Ya está con Claude · ${r.ticket.ref}` });
      router.refresh();
    } catch (e) {
      toast({ text: e instanceof Error && e.message.includes("sample") ? "Los datos de muestra no se envían a Claude" : "No se pudo dar a Claude" });
    }
  };

  const dispatchSel = async () => {
    const ids = selCards.map((c) => c.id);
    setBusy(true);
    try {
      const r = await tableroApi.dispatchMany(ids);
      clear();
      toast({ text: dispatchToast(r.results, r.skipped.length), duration: 6000 });
      router.refresh();
    } catch {
      toast({ text: "No se pudieron dar a Claude" });
    } finally {
      setBusy(false);
    }
  };

  const targets = useMemo(() => ignoreTargets(selCards), [selCards]);
  const ignoreSel = async () => {
    if (!targets.length) return;
    clear();
    await ignoreMany(targets);
  };

  const cardActions = (c: Card): MenuAction[] => [
    { label: "Mover…", onSelect: () => setMoving(c) },
    ...(canDispatch(c) ? [{ label: "Dárselo a Claude", detail: "Abre un ticket; el lead le asigna un agente", onSelect: () => void dispatchOne(c) }] : []),
    ...(c.owner ? [{ label: `Abrir ticket ${c.owner.ticketRef}`, detail: c.owner.label, onSelect: () => router.push(c.owner!.href) }] : []),
    {
      label: sel.has(c.id) ? "Quitar de la selección" : "Seleccionar",
      detail: "Shift+clic elige un rango · Ctrl/Cmd+clic suma",
      onSelect: () => pickDesk({ shiftKey: false, ctrlKey: true, metaKey: false }, c),
    },
    ...(c.ignore ? [{ label: ignoreLabel(c.ignore), detail: "Sale del tablero y de Hoy; no se sincroniza", onSelect: () => void ignore(c.ignore!) }] : []),
  ];
  const cardMenu = (c: Card): CardMenu => ({
    onMore: (el) => menu.openFrom(el, `Acciones de ${c.title}`, cardActions(c), "end"),
    onContext: menu.onContext(`Acciones de ${c.title}`, cardActions(c)),
  });

  const onDrop = (station: Station) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/mesa-task");
    const c = cards.find((x) => x.id === id);
    if (!c) return;
    // Dragging a selected card carries the whole selection.
    if (sel.has(c.id) && selCards.length > 1) void moveMany(selCards.map((x) => x.id), station);
    else void move(c, station);
  };

  const dropProps = (lane: Source, station: Station) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("text/mesa-task")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== `${lane}:${station}`) setOver(`${lane}:${station}`);
    },
    onDragLeave: () => setOver((o) => (o === `${lane}:${station}` ? null : o)),
    onDrop: onDrop(station),
  });

  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const retry = async () => {
    const res = await fetch("/api/github/sync", { method: "POST" }).catch(() => null);
    toast({ text: res?.ok ? "Reintentando la sincronización" : "La sincronización con GitHub aún no está disponible" });
    router.refresh();
  };

  // ---------- phone: long-press enters selection mode ----------
  const press = useRef<{ id: string; timer: ReturnType<typeof setTimeout> | null; fired: boolean; x: number; y: number } | null>(null);
  const touchLast = useRef(false);
  const phoneHandlers = (c: Card) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      touchLast.current = e.pointerType !== "mouse";
      if (e.pointerType === "mouse") return;
      if (press.current?.timer) clearTimeout(press.current.timer);
      const p = { id: c.id, fired: false, x: e.clientX, y: e.clientY, timer: null as ReturnType<typeof setTimeout> | null };
      p.timer = setTimeout(() => {
        p.fired = true;
        p.timer = null;
        if (typeof navigator !== "undefined") navigator.vibrate?.(12);
        setSel((s) => new Set(s).add(c.id));
        anchor.current = c.id;
      }, LONG_PRESS_MS);
      press.current = p;
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const p = press.current;
      if (p?.timer && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) {
        clearTimeout(p.timer);
        p.timer = null;
      }
    },
    onPointerUp: () => {
      if (press.current?.timer) clearTimeout(press.current.timer);
      if (press.current) press.current.timer = null;
    },
    onPointerCancel: () => {
      if (press.current?.timer) clearTimeout(press.current.timer);
      press.current = null;
    },
    onClick: (e: ReactMouseEvent) => {
      const p = press.current;
      if (p?.fired && p.id === c.id) {
        press.current = null;
        return;
      }
      if (selecting || e.shiftKey || e.ctrlKey || e.metaKey) pickPhone(e, c);
      else setMoving(c);
    },
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      // A long press is selection on the phone; the menu stays for a right click.
      if (touchLast.current || selecting) {
        e.preventDefault();
        return;
      }
      menu.onContext(`Acciones de ${c.title}`, cardActions(c))(e);
    },
  });

  const broken = !data.sandbox && data.sync.state === "error";
  const tabs = [{ key: "all" as const, label: "Todas", count: lanes.all }, ...LANES.map((s) => ({ key: s, label: SOURCE_LABEL[s], count: lanes[s], source: s }))];
  const visibleLanes = filter === "all" ? LANES : LANES.filter((l) => l === filter);
  const here = useMemo(() => {
    const out = Object.fromEntries(STATIONS.map((st) => [st, 0])) as Record<Station, number>;
    for (const c of selCards) out[c.station] += 1;
    return out;
  }, [selCards]);
  const ignoreText = targets.length === 1 ? ignoreLabel(targets[0]!) : targets.length > 1 ? `Ignorar ${targets.length} proyectos` : null;
  const anyDispatch = selCards.some(canDispatch);

  const renderCard = (c: Card) => (
    <CardView key={c.id} c={c} onMove={setMoving} draggable menu={cardMenu(c)} selected={sel.has(c.id)} selecting={selecting} onPick={pickDesk} syncOff={data.sandbox} />
  );

  return (
    <div className={selecting ? "tb is-selecting" : "tb"}>
      <div className="tb-head">
        <h1>
          Tablero<span>GitHub Project privado · {data.projectLabel}</span>
        </h1>
        <div className="tb-head-acts">
          <button type="button" className="btn sm" onClick={() => setNewOpen(true)}>
            + Tarea
          </button>
          <a className="btn sm" href={data.projectUrl} target="_blank" rel="noreferrer">
            Abrir en GitHub
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 2h4v4M12 2L6.5 7.5M10 8.5V12H2V4h3.5" />
            </svg>
          </a>
        </div>
      </div>

      <div className="tb-tools">
        <Tabs items={tabs} value={filter} onChange={setFilter} label="Fuentes" />
        <label className="tb-search">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.8" />
            <path d="M10.6 10.6L14 14" />
          </svg>
          <span className="sr-only">Buscar en el tablero</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en el tablero" type="search" />
        </label>
        <SyncStatus s={data.sync} sandbox={data.sandbox} />
      </div>

      {broken ? (
        <div className="tb-alert">
          <Alert
            icon={<BrokenLine source="github" width={32} title="Sin sincronizar" />}
            actions={
              <>
                <Btn size="sm" variant="primary" onClick={() => void retry()}>
                  Reintentar
                </Btn>
                <a className="btn sm" href="https://cli.github.com/manual/gh_auth_refresh" target="_blank" rel="noreferrer">
                  Cómo renovar el token
                </a>
              </>
            }
          >
            <b>No se pudo sincronizar con GitHub Project.</b> {data.sync.error ?? ""}
            {data.sync.error && !data.sync.error.endsWith(".") ? "." : ""} {data.sync.pending === 1 ? "Tu movimiento quedó guardado" : `Tus ${data.sync.pending} movimientos quedaron guardados`} aquí y se
            envían al reconectar.
          </Alert>
        </div>
      ) : null}

      {/* desktop: lanes by source */}
      <div
        className={broken ? "tb-grid is-broken" : "tb-grid"}
        ref={(el) => {
          boardRef.current = el;
          pressRef.current = el;
        }}
      >
        <div className="tb-st" />
        {STATIONS.map((st) => {
          const ids = stationIds(grid, st, visibleLanes);
          return (
            <div key={st} className="tb-st">
              <span className="tb-cap">
                {STATION_LABEL[st]}
                <b>{counts[st]}</b>
              </span>
              {ids.length ? (
                <button type="button" className="tb-selall" aria-label={`Seleccionar estación ${STATION_LABEL[st]}`} title="Seleccionar estación" onClick={() => group(ids)}>
                  Seleccionar
                </button>
              ) : null}
            </div>
          );
        })}
        {LANES.map((lane) => {
          const quiet = isQuiet(all, lane);
          const dim = filter !== "all" && filter !== lane;
          const laneOpen = OPEN_STATIONS.flatMap((st) => grid[lane][st].map((c) => c.id));
          return (
            <div key={lane} className={["tb-lane", quiet && "quiet", dim && "dim"].filter(Boolean).join(" ")} style={{ "--lane": LANE_VAR[lane] } as React.CSSProperties}>
              <div className="tb-lab">
                <span className="tb-src">
                  <SourceDot source={lane} />
                  {SOURCE_LABEL[lane]} {lanes[lane]}
                </span>
                <small>{LANE_NOTE[lane]}</small>
                {laneOpen.length && !dim ? (
                  <button type="button" className="tb-selall lane" aria-label={`Seleccionar carril ${SOURCE_LABEL[lane]}`} onClick={() => group(laneOpen)}>
                    Seleccionar carril
                  </button>
                ) : null}
              </div>
              {STATIONS.map((st, si) => {
                const key = `${lane}:${st}`;
                const list = grid[lane][st];
                const isOpen = open.has(key);
                const cellCls = ["tb-cell", over === key && "is-over"].filter(Boolean).join(" ");
                if (st === "done") {
                  const { shown, more } = capCell(list, DONE_CAP);
                  return (
                    <div key={st} className={cellCls} {...dropProps(lane, st)}>
                      {list.length ? (
                        <button type="button" className="tb-done" aria-expanded={isOpen} onClick={() => toggle(key)}>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M2.5 7.5l3 3 6-7" />
                          </svg>
                          {list.length} hoy
                        </button>
                      ) : quiet ? null : (
                        <span className="tb-gap">Nada hecho hoy</span>
                      )}
                      {isOpen ? (
                        <>
                          {shown.map(renderCard)}
                          {more ? <span className="tb-more static">{more} más hechas hoy</span> : null}
                        </>
                      ) : null}
                    </div>
                  );
                }
                const { shown, more } = isOpen ? { shown: list, more: 0 } : capCell(list);
                return (
                  <div key={st} className={cellCls} {...dropProps(lane, st)}>
                    {shown.map(renderCard)}
                    {more ? (
                      <button type="button" className="tb-more" onClick={() => toggle(key)}>
                        {more} más en {STATION_LABEL[st]}
                      </button>
                    ) : null}
                    {!list.length && quiet && si === 0 ? <span className="tb-gap">Nada abierto</span> : null}
                    {!list.length && !quiet ? <span className="tb-gap">Nada aquí</span> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* phone: station tabs, one lane per source for the chosen station */}
      <div className="tb-ph">
        <div className="tb-ph-top">
          <h1>
            Tablero
            <span>
              {STATION_LABEL[phoneStation]} {counts[phoneStation]}
            </span>
          </h1>
          {selecting ? (
            <button type="button" className="tb-selall on" onClick={() => group(stationIds(all, phoneStation))}>
              Seleccionar estación
            </button>
          ) : (
            <button type="button" className="btn sm tb-ph-new" onClick={() => setNewOpen(true)}>
              + Tarea
            </button>
          )}
        </div>
        <div className="tb-ph-sts">
          <Tabs items={STATIONS.map((s) => ({ key: s, label: STATION_LABEL[s], count: counts[s] }))} value={phoneStation} onChange={setPhoneStation} label="Estaciones" />
        </div>
        {broken ? (
          <p className="tb-ph-err">
            <BrokenLine source="github" width={26} title="Sin sincronizar" /> Sin sincronizar con GitHub Project. Tus movimientos se guardan aquí.
          </p>
        ) : null}
        {!selecting && cards.length ? <p className="tb-ph-hint">Mantén pulsada una tarjeta para elegir varias.</p> : null}
        <div className="tb-ph-lanes">
          {LANES.map((lane) => {
            const list = all[lane][phoneStation];
            return (
              <section key={lane} className={list.length ? "tb-ph-lane" : "tb-ph-lane quiet"} style={{ "--lane": LANE_VAR[lane] } as React.CSSProperties}>
                <div className="lh">
                  {SOURCE_LABEL[lane]}
                  <small>{list.length}</small>
                  {selecting && list.length ? (
                    <button type="button" className="tb-selall on" aria-label={`Seleccionar carril ${SOURCE_LABEL[lane]}`} onClick={() => group(list.map((c) => c.id))}>
                      Seleccionar carril
                    </button>
                  ) : null}
                </div>
                {list.length ? (
                  list.map((c) => {
                    const on = sel.has(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        data-card={c.id}
                        className={on ? "tb-ph-card is-sel" : "tb-ph-card"}
                        aria-pressed={selecting ? on : undefined}
                        aria-label={selecting ? `${c.title}. ${on ? "Seleccionada" : "Sin seleccionar"}` : `${c.title}. Mover`}
                        {...phoneHandlers(c)}
                      >
                        {selecting ? <span className={on ? "tb-ph-box on" : "tb-ph-box"} aria-hidden="true" /> : null}
                        <b>{c.title}</b>
                        <small>{[...(c.files ? [c.files.label] : []), ...c.chips.map((x) => x.label), c.time].join(" · ")}</small>
                        {c.wait || c.owner || (!data.sandbox && c.syncState !== "synced") ? (
                          <span className="tb-ph-tags">
                            {c.owner ? <span className="lk src-claude tb-owner">{c.owner.label}</span> : null}
                            {c.wait && !(c.owner && c.wait.tone === "cl") ? <StatusTag tone={c.wait.tone}>{c.wait.label}</StatusTag> : null}
                            {!data.sandbox && c.syncState !== "synced" ? <StatusTag tone="off">{c.syncState === "error" ? "Sin sincronizar · error" : "Sin sincronizar"}</StatusTag> : null}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="tb-ph-quiet">Nada en {STATION_LABEL[phoneStation].toLowerCase()}</div>
                )}
              </section>
            );
          })}
        </div>
        {data.hasSample ? <p className="tb-sample">Datos de muestra.</p> : null}
      </div>

      {data.hasSample ? <p className="tb-sample desk">Datos de muestra.</p> : null}

      {selecting ? (
        <BatchBar
          count={selCards.length}
          busy={busy}
          here={here}
          openMenu={menu.openFrom}
          onMove={(st) => void moveMany(selCards.map((c) => c.id), st)}
          onDispatch={anyDispatch ? () => void dispatchSel() : null}
          ignoreLabel={ignoreText}
          onIgnore={() => void ignoreSel()}
          onCancel={clear}
        />
      ) : null}

      <NewTaskSheet open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => router.refresh()} />

      <Sheet open={Boolean(moving)} onClose={() => setMoving(null)} title={moving ? `Mover «${moving.title}»` : "Mover"}>
        {moving ? (
          <>
            <div className="tb-move" role="group" aria-label="Estaciones">
              {STATIONS.map((st) => {
                const isHere = moving.station === st;
                return (
                  <button
                    key={st}
                    type="button"
                    className={isHere ? "btn on" : "btn"}
                    aria-current={isHere ? "true" : undefined}
                    onClick={(e) => {
                      confirmPick(e.currentTarget);
                      const c = moving;
                      setMoving(null);
                      void move(c, st);
                    }}
                  >
                    {st === "waiting" ? "Espera" : STATION_LABEL[st]}
                    <small>{isHere ? "aquí" : counts[st]}</small>
                  </button>
                );
              })}
            </div>
            <p className="tb-sheet-note">Se sincroniza con el GitHub Project · Sin sincronizar hasta confirmar</p>
            {canDispatch(moving) || moving.owner ? (
              <div className="tb-sheet-acts">
                {canDispatch(moving) ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const c = moving;
                      setMoving(null);
                      void dispatchOne(c);
                    }}
                  >
                    Dárselo a Claude
                  </button>
                ) : null}
                {moving.owner ? (
                  <Link className="btn" href={moving.owner.href} onClick={() => setMoving(null)}>
                    Abrir ticket {moving.owner.ticketRef} · {moving.owner.label}
                  </Link>
                ) : null}
              </div>
            ) : null}
            {moving.ignore ? (
              <button
                type="button"
                className="ig-link tb-sheet-ign"
                onClick={() => {
                  const t = moving.ignore!;
                  setMoving(null);
                  void ignore(t);
                }}
              >
                {ignoreLabel(moving.ignore)}
              </button>
            ) : null}
          </>
        ) : null}
      </Sheet>
      {menu.node}
    </div>
  );
}
