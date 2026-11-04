"use client";
// Detail pane for a selected item (salidas use <SalidaApproval compact />).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Btn, ContextQuote, Kind, Label, LinkChip } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/interactive";
import { confirmPick } from "@/lib/motion";
import { STATION_LABEL, STATIONS, type Station } from "@/lib/domain/types";
import type { SourceHealth } from "@/components/shell/health";
import type { DoneRow, ItemDetail, SetupRow } from "./model";
import { LineStub } from "@/components/line/Line";
import { ignoreLabel } from "../ignore/model";
import { useIgnore } from "../ignore/useIgnore";

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(e?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function ItemDetailPane({ d, health }: { d: ItemDetail; health?: SourceHealth }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { ignore } = useIgnore();

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ text: ok });
      router.refresh();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo" });
    } finally {
      setBusy(false);
    }
  };

  const move = (s: Station) =>
    run(
      () => (d.taskId ? call(`/api/tasks/${d.taskId}/move`, "POST", { station: s }) : call(`/api/items/${d.id}`, "PATCH", { station: s })),
      `Movido a ${STATION_LABEL[s]}`,
    );

  const createTask = () =>
    run(
      () => call("/api/tasks", "POST", { title: d.title, source: d.source, project: d.project, excerpt: d.excerpt, station: d.station, itemIds: [d.id] }),
      "Tarea creada en el tablero",
    );

  const stale = health && health.state !== "ok";
  const primaryHref = d.ticketRef ? `/tickets?ref=${encodeURIComponent(d.ticketRef)}` : d.url;

  return (
    <div className="hy-item">
      <Kind source={d.source}>{d.kindLabel}</Kind>
      <h2 className="hy-h2">{d.title}</h2>
      {d.excerpt ? (
        <>
          <Label>Contexto</Label>
          <ContextQuote>{d.excerpt}</ContextQuote>
        </>
      ) : null}
      {d.project || d.url ? (
        <>
          <Label>Origen</Label>
          <div className="hy-dest">
            <LinkChip source={d.source} href={d.url ?? undefined}>
              {d.project || d.linkLabel}
            </LinkChip>
            {d.ticketRef ? <LinkChip source="claude">Ticket {d.ticketRef}</LinkChip> : null}
          </div>
        </>
      ) : null}
      <Label>Estación</Label>
      <div className="hy-move" role="group" aria-label="Mover a otra estación">
        {STATIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={s === d.station ? "tab on" : "tab"}
            aria-pressed={s === d.station}
            disabled={busy}
            onClick={(e) => {
              confirmPick(e.currentTarget);
              if (s !== d.station) void move(s);
            }}
          >
            {STATION_LABEL[s]}
          </button>
        ))}
      </div>
      {stale ? <p className="hy-hint">{health?.rowNote}. Lo que ves es el último dato que llegó.</p> : null}
      <div className="hy-acts">
        {primaryHref ? (
          d.ticketRef ? (
            <Link className="btn p" href={primaryHref}>
              Responder en Tickets
            </Link>
          ) : (
            <a className="btn p" href={primaryHref} target="_blank" rel="noreferrer">
              {d.linkLabel}
            </a>
          )
        ) : null}
        {d.taskId ? (
          <Link className="btn" href="/tablero">
            Ver en el tablero
          </Link>
        ) : (
          <Btn disabled={busy} onClick={() => void createTask()}>
            Crear tarea
          </Btn>
        )}
      </div>
      <div className="hy-meta">
        <span>Llegó {d.received}</span>
        {d.isSample ? <span>Datos de muestra.</span> : null}
      </div>
      {d.ignore ? (
        <div className="hy-ign-d">
          <button
            type="button"
            className="ig-link"
            disabled={busy}
            onClick={() => {
              if (!d.ignore) return;
              setBusy(true);
              void ignore(d.ignore).finally(() => setBusy(false));
            }}
          >
            {ignoreLabel(d.ignore)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function DonePane({ done, nextCheckAt, sample }: { done: DoneRow[]; nextCheckAt: string | null; sample: boolean }) {
  return (
    <div>
      <Label>Hecho hoy · {done.length}</Label>
      {done.length ? (
        <ul className="hy-done">
          {done.slice(0, 12).map((x) => (
            <li key={x.id}>
              <LineStub source={x.source} width={16} />
              <span>{x.title}</span>
              <time>{x.time}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hy-hint">Todavía nada hoy.</p>
      )}
      <div className="hy-meta">
        <span>{nextCheckAt ? `Próxima revisión ${nextCheckAt}` : "Claude revisa las fuentes cada minuto"}</span>
        {sample ? <span>Datos de muestra.</span> : null}
      </div>
    </div>
  );
}

export function FirstRunPane() {
  return (
    <div>
      <Label>Cómo funciona</Label>
      <p className="hy-hint">
        Claude revisa las fuentes, te pregunta en Tickets y redacta respuestas. Nada sale sin que firmes el texto y el destino exactos en Salidas.
      </p>
      <Label>Desde el teléfono</Label>
      <p className="hy-hint">Abre el enlace del túnel con tu token. El enlace vive en la PC; no se comparte.</p>
      <div className="hy-meta">
        <span>Primera vez</span>
      </div>
    </div>
  );
}

export function SetupList({ rows }: { rows: SetupRow[] }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (r: SetupRow) => {
    setBusy(r.key);
    try {
      if (r.key === "github_project" || r.key === "github") {
        const res = await fetch("/api/github/sync", { method: "POST" });
        if (!res.ok) throw new Error("La sincronización con GitHub aún no está disponible");
        toast({ text: "Buscando o creando el Project «Mesa»" });
      } else {
        await call("/api/sweep", "POST", { sources: [r.key] });
        toast({ text: `Claude está probando ${r.name}` });
      }
      router.refresh();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="hy-setup">
      {rows.map((r) => (
        <div key={r.key} className="hy-setup-row">
          <LineStub source={r.line} width={20} />
          <b>{r.name}</b>
          <span>{r.detail}</span>
          {r.connected ? (
            <span className="hy-ok">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 7.5l3 3 6-7" />
              </svg>
              Conectado
            </span>
          ) : (
            <Btn size="sm" variant={r.key === "github_project" ? "primary" : "secondary"} disabled={busy === r.key} onClick={() => void act(r)}>
              {r.key === "github_project" ? "Crear «Mesa»" : r.key === "github" ? "Conectar" : "Probar conexión"}
            </Btn>
          )}
        </div>
      ))}
    </div>
  );
}
