"use client";
// Hoy: the line band, source tabs, the rows of the selected station, and the detail pane.
// Phone (<= 720px): corridor band, scrolling station tabs, 66px rows, full-screen detail.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BrandMark, BrokenLine, SourceDot } from "@/components/line/Line";
import { Btn } from "@/components/ui/primitives";
import { Tabs, useToast } from "@/components/ui/interactive";
import { STATION_LABEL, STATIONS, type Source, type Station } from "@/lib/domain/types";
import { useArrive, usePress } from "@/lib/motion";
import { Corridor } from "../band/Corridor";
import { LineBand } from "../band/LineBand";
import { BatchBar } from "./BatchBar";
import { DonePane, FirstRunPane, ItemDetailPane, SetupList } from "./HoyDetail";
import { hoyApi } from "./api";
import { isCalm, sourceCounts, visibleRows, type HoyData, type HoyRow } from "./model";
import { ApprovalCard } from "@/features/approvals/ApprovalCard";
import { SalidaApproval } from "@/features/salidas/SalidaApproval";
import { clock } from "./format";
import { LeadFocus } from "./LeadFocus";
import { useLive } from "./useLive";
import { MoreButton, useActionMenu, type MenuAction } from "../ignore/ActionMenu";
import { IgnoredLink } from "../ignore/IgnoredSheet";
import { ignoreLabel } from "../ignore/model";
import { useIgnore } from "../ignore/useIgnore";
import { dispatchToast } from "../tablero/api";
import { rangeIds, toggleId } from "../tablero/model";
import "../ignore/ignore.css";
import "../band/band.css";
import "./hoy.css";

const LONG_PRESS_MS = 450;

const LEGEND: Source[] = ["github", "slack", "claude", "basecamp"];
const TAB_ORDER: Source[] = ["github", "basecamp", "slack", "claude"];
const NAME: Record<Source, string> = { github: "GitHub", slack: "Slack", basecamp: "Basecamp", claude: "Claude" };

function SweepButton({ compact }: { compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const sweep = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/sweep", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (res.status === 409) return void toast({ text: "Sandbox: aquí no se barre Slack ni Basecamp" });
      if (!res.ok) throw new Error();
      toast({ text: "Claude está barriendo Slack y Basecamp" });
    } catch {
      toast({ text: "No se pudo pedir el barrido" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Btn size="sm" className={compact ? "hy-sweep compact" : "hy-sweep"} disabled={busy} onClick={() => void sweep()} aria-label="Barrer ahora">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13.5 8A5.5 5.5 0 113 5" />
        <path d="M3 1.8V5h3.2" />
      </svg>
      {compact ? null : "Barrer ahora"}
    </Btn>
  );
}

interface RowMenu {
  actions: MenuAction[];
  onMore: (el: HTMLElement) => void;
  onContext: React.MouseEventHandler<HTMLElement>;
}

/** Click modifiers the selection reads (a row click, the checkbox). */
type Mods = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };

/** What an item row needs to be selectable (salidas never get it). */
interface RowPick {
  on: boolean;
  onToggle: (e: Mods) => void;
  press: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  };
}

function Row({ r, selected, onOpen, menu, pick }: { r: HoyRow; selected: boolean; onOpen: (e: ReactMouseEvent) => void; menu?: RowMenu; pick?: RowPick }) {
  const row = (
    <button
      type="button"
      className={["hy-row", selected && "sel", pick?.on && "is-sel", r.stale && "stale", `src-${r.source}`].filter(Boolean).join(" ")}
      aria-current={selected ? "true" : undefined}
      data-row={r.key}
      onClick={onOpen}
      onMouseDown={(e) => {
        // Shift+click selects a range: do not start a text selection.
        if (e.shiftKey) e.preventDefault();
      }}
      onContextMenu={pick?.press.onContextMenu ?? menu?.onContext}
      onPointerDown={pick?.press.onPointerDown}
      onPointerMove={pick?.press.onPointerMove}
      onPointerUp={pick?.press.onPointerUp}
      onPointerCancel={pick?.press.onPointerCancel}
    >
      <span className="t">{r.time}</span>
      <span className="src">
        <SourceDot source={r.source} />
        <span className="src-name">{NAME[r.source]}</span>
      </span>
      <span className="subj">
        {r.subject}
        <small>{r.excerpt}</small>
      </span>
      <span className="need">{r.need}</span>
      <span className={`st ${r.tag.tone === "plain" ? "" : r.tag.tone} desk-only`}>{r.tag.label}</span>
      <span className={`st ${r.phoneTag.tone === "plain" ? "" : r.phoneTag.tone} phone-only`}>{r.phoneTag.label}</span>
    </button>
  );
  if (!pick) return row;
  // The checkbox takes the source dot's place while you point at the row or while anything is selected. It sits
  // outside the row button (buttons never nest) and stays in the tab order; so does the overflow trigger, which
  // sits over the time column (shown on hover / focus, like the Tablero card's Mover).
  return (
    <div className="hy-rw pick">
      {row}
      <span className="hy-pick">
        <input type="checkbox" checked={pick.on} aria-label={`Seleccionar «${r.subject}»`} onChange={() => undefined} onClick={(e) => pick.onToggle(e)} />
        <span className="hy-box" aria-hidden="true" />
      </span>
      {menu ? <MoreButton className="hy-more" label={`Más acciones: ${r.subject}`} onOpen={menu.onMore} /> : null}
    </div>
  );
}

export function HoyView({ data }: { data: HoyData }) {
  const live = useLive();
  const [station, setStation] = useState<Station>("inbox");
  const [source, setSource] = useState<Source | "all">("all");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const anchor = useRef<string | null>(null);

  const { items, salidas } = useMemo(() => visibleRows(data.rows, station, source), [data.rows, station, source]);
  const counts = useMemo(() => sourceCounts(data.rows, station), [data.rows, station]);
  const all = useMemo(() => [...items, ...salidas], [items, salidas]);
  const selected = all.find((r) => r.key === selKey) ?? salidas[0] ?? items[0] ?? null;
  const waiting = data.rows.filter((r) => r.station === station && r.waitsOnYou).length;
  const down = LEGEND.filter((s) => data.health[s] && data.health[s]!.state !== "ok");
  const calm = station === "inbox" && isCalm(data);
  const listRef = useArrive<HTMLDivElement>(".hy-row", `${station}:${source}`);
  const pressRef = usePress<HTMLDivElement>(".hy-row", true);
  const menu = useActionMenu();
  const { ignore } = useIgnore();

  // ---------- selection (item rows only) ----------
  const picked = useMemo(() => items.filter((r) => sel.has(r.id)), [items, sel]);
  const selecting = picked.length > 0;
  const clear = useCallback(() => {
    setSel(new Set());
    anchor.current = null;
  }, []);

  /** Shift: range from the anchor in the list's order; otherwise toggle one row. */
  const toggleRow = (e: Mods, r: HoyRow) => {
    if (e.shiftKey && anchor.current) {
      const ids = rangeIds(items, anchor.current, r.id);
      setSel((s) => new Set([...s, ...ids]));
      return;
    }
    setSel((s) => toggleId(s, r.id));
    anchor.current = r.id;
  };

  // The selection belongs to the rows on screen: a new station or source starts clean.
  const goStation = (s: Station) => {
    clear();
    setStation(s);
  };
  const goSource = (s: Source | "all") => {
    clear();
    setSource(s);
  };

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || menu.open) return;
      clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting, menu.open, clear]);

  // Phone: a long press on an item row starts a selection.
  const press = useRef<{ id: string; timer: ReturnType<typeof setTimeout> | null; fired: boolean; x: number; y: number } | null>(null);
  const touchLast = useRef(false);
  const pressHandlers = (r: HoyRow, onMenu?: React.MouseEventHandler<HTMLElement>): RowPick["press"] => ({
    onPointerDown: (e) => {
      touchLast.current = e.pointerType !== "mouse";
      if (e.pointerType === "mouse") return;
      if (press.current?.timer) clearTimeout(press.current.timer);
      const p = { id: r.id, fired: false, x: e.clientX, y: e.clientY, timer: null as ReturnType<typeof setTimeout> | null };
      p.timer = setTimeout(() => {
        p.fired = true;
        p.timer = null;
        if (typeof navigator !== "undefined") navigator.vibrate?.(12);
        setSel((s) => new Set(s).add(r.id));
        anchor.current = r.id;
      }, LONG_PRESS_MS);
      press.current = p;
    },
    onPointerMove: (e) => {
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
    onContextMenu: (e) => {
      // A long press is selection on the phone; the menu stays for a right click.
      if (touchLast.current || selecting) {
        e.preventDefault();
        return;
      }
      onMenu?.(e);
    },
  });

  const rowMenu = (r: HoyRow): RowMenu => {
    const t = r.kind === "item" ? r.ignore : null;
    const actions: MenuAction[] = [
      {
        label: sel.has(r.id) ? "Quitar de la selección" : "Seleccionar",
        detail: "Shift+clic elige un rango · Ctrl/Cmd+clic suma",
        onSelect: () => toggleRow({ shiftKey: false, ctrlKey: true, metaKey: false }, r),
      },
      ...(t ? [{ label: ignoreLabel(t), detail: "Sale de Hoy y del tablero; Claude deja de barrerlo", onSelect: () => void ignore(t) }] : []),
    ];
    return { actions, onMore: (el) => menu.openFrom(el, `Acciones de ${r.subject}`, actions), onContext: menu.onContext(`Acciones de ${r.subject}`, actions) };
  };
  const itemRow = (r: HoyRow) => {
    const m = rowMenu(r);
    const pick: RowPick = { on: sel.has(r.id), onToggle: (e) => toggleRow(e, r), press: pressHandlers(r, m.onContext) };
    const onOpen = (e: ReactMouseEvent) => {
      const p = press.current;
      if (p?.fired && p.id === r.id) {
        press.current = null; // the long press already selected it
        return;
      }
      if (e.shiftKey || e.ctrlKey || e.metaKey || selecting) toggleRow(e, r);
      else openRow(r);
    };
    return <Row key={r.key} r={r} selected={selected?.key === r.key} onOpen={onOpen} menu={m} pick={pick} />;
  };

  const dispatchSel = async () => {
    setBusy(true);
    try {
      const out = await hoyApi.dispatchItems(picked.map((r) => r.id));
      clear();
      toast({ text: dispatchToast(out.results, out.skipped.length), duration: 6000 });
      router.refresh();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudieron pasar a Claude" });
    } finally {
      setBusy(false);
    }
  };

  // Close the phone detail if its row went away (sent, moved).
  useEffect(() => {
    if (open && !selected) {
      const id = window.setTimeout(() => setOpen(false), 0);
      return () => window.clearTimeout(id);
    }
  }, [open, selected]);

  const openRow = (r: HoyRow) => {
    setSelKey(r.key);
    setOpen(true);
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".hy-row")];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
      setSelKey(next.dataset.row ?? null);
    }
  };

  const tabs = [
    { key: "all" as const, label: "Todo", count: counts.all },
    ...TAB_ORDER.map((s) => ({ key: s, label: NAME[s], count: counts[s], source: s })),
  ];
  const stationTabs = STATIONS.map((s) => ({ key: s, label: STATION_LABEL[s], count: data.stations[s] }));

  const offlineNote = live.offline ? (
    <div className="alert hy-off" role="alert">
      <div className="hy-off-row">
        <svg width="32" height="14" viewBox="0 0 32 14" aria-hidden="true" style={{ flex: "none" }}>
          <path d="M2 7H11M21 7H30" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M13 11L19 3" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <p>
          <b>Sin conexión con tu PC.</b> El túnel no responde{live.downSince ? ` desde las ${clock(live.downSince)}` : ""}.
          {live.lastOk ? ` Ves lo último que llegó, de las ${clock(live.lastOk)}.` : " Ves lo último que llegó."}
        </p>
      </div>
      <Btn variant="primary" onClick={live.retry}>
        Reintentar
      </Btn>
    </div>
  ) : null;

  let detail: React.ReactNode;
  if (data.firstRun) detail = <FirstRunPane />;
  else if (calm || !selected) detail = <DonePane done={data.done} nextCheckAt={data.nextCheckAt} sample={data.hasSample} />;
  else if (selected.kind === "salida") detail = <SalidaApproval key={selected.id} salidaId={selected.id} compact />;
  else {
    const d = data.details[selected.id];
    detail = d ? <ItemDetailPane key={d.id} d={d} health={d.source === "claude" ? undefined : data.health[d.source]} /> : null;
  }

  return (
    <div className={["hy", open && selected ? "is-open" : "", live.offline ? "is-offline" : "", selecting ? "is-selecting" : ""].join(" ")}>
      <section className="hy-band" aria-label="Línea del día">
        <div className="hy-bandhead">
          <h1>
            Línea del día<span>{data.dayLong}</span>
          </h1>
          <SweepButton />
          <div className="hy-legend">
            {LEGEND.map((s) => {
              const h = data.health[s];
              return h && h.state !== "ok" ? (
                <span key={s} className="down">
                  <BrokenLine source={s} width={26} title={h.legend} />
                  {h.legend}
                </span>
              ) : (
                <span key={s}>
                  <i style={{ background: `var(--${{ github: "gh", slack: "sl", claude: "cl", basecamp: "bc" }[s]})` }} />
                  {NAME[s]}
                </span>
              );
            })}
          </div>
        </div>
        <LineBand items={data.band} counts={data.stations} station={station} source={source} down={down} onStation={goStation} stale={live.offline} />
      </section>

      <header className="hy-ph-top">
        <BrandMark size={24} />
        <h1>
          Hoy<span>{data.dayShort}</span>
        </h1>
        <SweepButton compact />
      </header>
      {offlineNote ? <div className="hy-ph-off">{offlineNote}</div> : null}

      <div className={live.offline ? "hy-body is-offline" : "hy-body"}>
        <Corridor items={data.band} counts={data.stations} station={station} waitingOnYou={waiting} down={down} stale={live.offline} />
        <div className="hy-phsts">
          <Tabs items={stationTabs} value={station} onChange={goStation} label="Estaciones" />
        </div>

        <div className="hy-main" ref={pressRef}>
          {offlineNote ? <div className="hy-desk-off">{offlineNote}</div> : null}
          {data.approvals.length || data.leadFocus ? (
            <section id="permisos" className="hy-perm" aria-label="Permisos">
              <div className="grp">{data.approvals.length ? "Permisos · esperan tu decisión" : "Permisos"}</div>
              {data.leadFocus ? <LeadFocus focus={data.leadFocus} /> : null}
              <fieldset className="hy-fs" disabled={live.offline}>
                {data.approvals.map((a) => (
                  <ApprovalCard key={a.id} approval={a} />
                ))}
              </fieldset>
            </section>
          ) : null}

          <div className="hy-tabs">
            <Tabs items={tabs} value={source} onChange={goSource} label="Fuentes" trailing={
                <>
                  <IgnoredLink rows={data.ignored} className="hy-ign" />
                  <span className="sort">Estación: {STATION_LABEL[station]} · por hora</span>
                </>
              } />
          </div>

          {data.firstRun ? (
            <div className="hy-calm wide">
              <h2>Conecta tus fuentes</h2>
              <p>Mesa lee GitHub, Basecamp y Slack, y guarda el tablero en un GitHub Project privado. Cuando todo esté conectado, la línea se llena.</p>
              <SetupList rows={data.setup} />
            </div>
          ) : calm ? (
            <div className="hy-calm">
              <h2>Nada te espera</h2>
              <p>
                Revisado a las {data.checkedAt}: {down.length ? `${down.map((s) => NAME[s]).join(" y ")} sin conexión` : "GitHub, Basecamp y Slack al día"}, y Claude no tiene preguntas. Lo que entre aparece en Inbox.
              </p>
              <div className="hy-acts">
                <Link className="btn" href="/tablero">
                  Ver el tablero
                </Link>
                <Link className="btn" href="/tickets?new=1">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M7 2v10M2 7h10" />
                  </svg>
                  Pedirle algo a Claude
                </Link>
              </div>
            </div>
          ) : (
            <div className="hy-list" ref={listRef} onKeyDown={onListKey}>
              <div className="hy-cols" aria-hidden="true">
                <span>Hora</span>
                <span>Origen</span>
                <span>Asunto</span>
                <span>Necesita</span>
                <span>Estado</span>
              </div>
              {items.map(itemRow)}
              {!items.length && !salidas.length ? (
                <p className="hy-empty">
                  Nada en {STATION_LABEL[station]}
                  {source !== "all" ? ` de ${NAME[source]}` : ""}.
                </p>
              ) : null}
              {salidas.length ? <div className="grp">Salidas · esperan tu firma</div> : null}
              {salidas.map((r) => (
                <Row key={r.key} r={r} selected={selected?.key === r.key} onOpen={() => openRow(r)} />
              ))}
              {live.offline ? <p className="hy-ro">Firmar y responder vuelven con la conexión: nada sale sin la PC.</p> : null}
            </div>
          )}
          {/* Phone: the source tabs are hidden, so the link sits under the list. */}
          {data.ignored.length ? (
            <div className="hy-ign-ph">
              <IgnoredLink rows={data.ignored} />
            </div>
          ) : null}
        </div>
      </div>

      <aside className="hy-detail" aria-label="Detalle">
        <div className="hy-ph-back">
          <button type="button" className="hy-back" onClick={() => setOpen(false)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 3L5 8l5 5" />
            </svg>
            Hoy
          </button>
          <span>{selected?.kind === "salida" ? `${salidas.findIndex((s) => s.key === selected.key) + 1} de ${salidas.length}` : ""}</span>
        </div>
        <fieldset className="hy-fs" disabled={live.offline}>
          {detail}
        </fieldset>
      </aside>
      {selecting ? <BatchBar count={picked.length} busy={busy || live.offline} onDispatch={() => void dispatchSel()} onCancel={clear} /> : null}
      {menu.node}
    </div>
  );
}
