"use client";
// Tablero B: one lane per source (its line runs behind its cards), five station
// columns. Drag a card between columns, or use "Mover" (bottom sheet on the phone).
// A move writes the station to SQLite; the card shows "Sin sincronizar" until lane C
// acks the GitHub Project write.
import { useRouter } from "next/navigation";
import { useMemo, useState, type DragEvent } from "react";
import { BrokenLine, SourceDot } from "@/components/line/Line";
import { Alert, Btn, LinkChip, StatusTag } from "@/components/ui/primitives";
import { Sheet, Tabs, useToast } from "@/components/ui/interactive";
import { SOURCE_LABEL, STATION_LABEL, STATIONS, type Source, type Station } from "@/lib/domain/types";
import { confirmPick, useArrive, usePress } from "@/lib/motion";
import { useLive } from "../hoy/useLive";
import type { TableroData } from "./data";
import { applyMove, capCell, groupBoard, isQuiet, LANE_NOTE, LANES, laneCounts, stationCounts, type Card } from "./model";
import "./tablero.css";

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

function CardView({ c, onMove, draggable }: { c: Card; onMove: (c: Card) => void; draggable: boolean }) {
  const done = c.station === "done";
  return (
    <article
      className={done ? "tb-card done" : "tb-card"}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/mesa-task", c.id);
        e.dataTransfer.effectAllowed = "move";
        e.currentTarget.classList.add("is-drag");
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove("is-drag")}
    >
      <div className="tb-top">
        <Mark c={c} />
        <span className="tb-proj">{c.project}</span>
        <time>{c.time}</time>
        <button type="button" className="tb-mv" aria-label={`Mover «${c.title}»`} onClick={() => onMove(c)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 7h10M9 4l3 3-3 3" />
          </svg>
        </button>
      </div>
      <h2 className="tb-t">{c.title}</h2>
      {done ? null : (
        <div className="tb-foot">
          {c.chips.map((x) => (
            <LinkChip key={x.label} source={x.source} href={x.url ?? undefined}>
              {x.label}
            </LinkChip>
          ))}
          {c.wait ? <StatusTag tone={c.wait.tone}>{c.wait.label}</StatusTag> : null}
          {c.syncState !== "synced" ? <StatusTag tone="off">{c.syncState === "error" ? "Sin sincronizar · error" : "Sin sincronizar"}</StatusTag> : null}
        </div>
      )}
    </article>
  );
}

function SyncStatus({ s }: { s: TableroData["sync"] }) {
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

  // Local moves win until the server shows the same station.
  const cards = useMemo(() => {
    let cs = data.cards;
    for (const [id, st] of Object.entries(local)) {
      const server = cs.find((c) => c.id === id);
      if (server && server.station !== st) cs = applyMove(cs, id, st);
    }
    return cs;
  }, [data.cards, local]);

  const grid = useMemo(() => groupBoard(cards, filter, query), [cards, filter, query]);
  const all = useMemo(() => groupBoard(cards, "all", query), [cards, query]);
  const counts = useMemo(() => stationCounts(cards), [cards]);
  const lanes = useMemo(() => laneCounts(cards), [cards]);
  const boardRef = useArrive<HTMLDivElement>(".tb-card", `${filter}:${query}`);
  const pressRef = usePress<HTMLDivElement>(".tb-card", true);

  const move = async (c: Card, station: Station) => {
    if (c.station === station) return;
    setLocal((m) => ({ ...m, [c.id]: station }));
    try {
      const res = await fetch(`/api/tasks/${c.id}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ station }),
      });
      if (!res.ok) throw new Error();
      toast({ text: `«${c.title}» a ${STATION_LABEL[station]} · Sin sincronizar hasta que GitHub confirme` });
      router.refresh();
    } catch {
      setLocal((m) => {
        const { [c.id]: _drop, ...rest } = m;
        void _drop;
        return rest;
      });
      toast({ text: "No se pudo mover la tarjeta" });
    }
  };

  const onDrop = (station: Station) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/mesa-task");
    const c = cards.find((x) => x.id === id);
    if (c) void move(c, station);
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

  const broken = data.sync.state === "error";
  const tabs = [{ key: "all" as const, label: "Todas", count: lanes.all }, ...LANES.map((s) => ({ key: s, label: SOURCE_LABEL[s], count: lanes[s], source: s }))];

  return (
    <div className="tb">
      <div className="tb-head">
        <h1>
          Tablero<span>GitHub Project privado · {data.projectLabel}</span>
        </h1>
        <a className="btn sm" href={data.projectUrl} target="_blank" rel="noreferrer">
          Abrir en GitHub
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 2h4v4M12 2L6.5 7.5M10 8.5V12H2V4h3.5" />
          </svg>
        </a>
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
        <SyncStatus s={data.sync} />
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
      <div className={broken ? "tb-grid is-broken" : "tb-grid"} ref={(el) => {
        boardRef.current = el;
        pressRef.current = el;
      }}>
        <div className="tb-st" />
        {STATIONS.map((st) => (
          <div key={st} className="tb-st">
            <span className="tb-cap">
              {STATION_LABEL[st]}
              <b>{counts[st]}</b>
            </span>
          </div>
        ))}
        {LANES.map((lane) => {
          const quiet = isQuiet(all, lane);
          const dim = filter !== "all" && filter !== lane;
          return (
            <div key={lane} className={["tb-lane", quiet && "quiet", dim && "dim"].filter(Boolean).join(" ")} style={{ "--lane": LANE_VAR[lane] } as React.CSSProperties}>
              <div className="tb-lab">
                <span className="tb-src">
                  <SourceDot source={lane} />
                  {SOURCE_LABEL[lane]} {lanes[lane]}
                </span>
                <small>{LANE_NOTE[lane]}</small>
              </div>
              {STATIONS.map((st, si) => {
                const key = `${lane}:${st}`;
                const list = grid[lane][st];
                const isOpen = open.has(key);
                const cls = ["tb-cell", over === key && "is-over"].filter(Boolean).join(" ");
                if (st === "done") {
                  const { shown, more } = capCell(list, DONE_CAP);
                  return (
                    <div key={st} className={cls} {...dropProps(lane, st)}>
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
                          {shown.map((c) => (
                            <CardView key={c.id} c={c} onMove={setMoving} draggable />
                          ))}
                          {more ? <span className="tb-more static">{more} más hechas hoy</span> : null}
                        </>
                      ) : null}
                    </div>
                  );
                }
                const { shown, more } = isOpen ? { shown: list, more: 0 } : capCell(list);
                return (
                  <div key={st} className={cls} {...dropProps(lane, st)}>
                    {shown.map((c) => (
                      <CardView key={c.id} c={c} onMove={setMoving} draggable />
                    ))}
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
        </div>
        <div className="tb-ph-sts">
          <Tabs items={STATIONS.map((s) => ({ key: s, label: STATION_LABEL[s], count: counts[s] }))} value={phoneStation} onChange={setPhoneStation} label="Estaciones" />
        </div>
        {broken ? (
          <p className="tb-ph-err">
            <BrokenLine source="github" width={26} title="Sin sincronizar" /> Sin sincronizar con GitHub Project. Tus movimientos se guardan aquí.
          </p>
        ) : null}
        <div className="tb-ph-lanes">
          {LANES.map((lane) => {
            const list = all[lane][phoneStation];
            return (
              <section key={lane} className={list.length ? "tb-ph-lane" : "tb-ph-lane quiet"} style={{ "--lane": LANE_VAR[lane] } as React.CSSProperties}>
                <div className="lh">
                  {SOURCE_LABEL[lane]}
                  <small>{list.length}</small>
                </div>
                {list.length ? (
                  list.map((c) => (
                    <button key={c.id} type="button" className="tb-ph-card" onClick={() => setMoving(c)} aria-label={`${c.title}. Mover`}>
                      <b>{c.title}</b>
                      <small>{[...c.chips.map((x) => x.label), c.time].join(" · ")}</small>
                      {c.wait || c.syncState !== "synced" ? (
                        <span className="tb-ph-tags">
                          {c.wait ? <StatusTag tone={c.wait.tone}>{c.wait.label}</StatusTag> : null}
                          {c.syncState !== "synced" ? <StatusTag tone="off">Sin sincronizar</StatusTag> : null}
                        </span>
                      ) : null}
                    </button>
                  ))
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

      <Sheet open={Boolean(moving)} onClose={() => setMoving(null)} title={moving ? `Mover «${moving.title}»` : "Mover"}>
        {moving ? (
          <>
            <div className="tb-move" role="group" aria-label="Estaciones">
              {STATIONS.map((st) => {
                const here = moving.station === st;
                return (
                  <button
                    key={st}
                    type="button"
                    className={here ? "btn on" : "btn"}
                    aria-current={here ? "true" : undefined}
                    onClick={(e) => {
                      confirmPick(e.currentTarget);
                      const c = moving;
                      setMoving(null);
                      void move(c, st);
                    }}
                  >
                    {st === "waiting" ? "Espera" : STATION_LABEL[st]}
                    <small>{here ? "aquí" : counts[st]}</small>
                  </button>
                );
              })}
            </div>
            <p className="tb-sheet-note">Se sincroniza con el GitHub Project · Sin sincronizar hasta confirmar</p>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
