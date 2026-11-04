"use client";
// Stand-in for lane B's <SalidaApproval salidaId compact /> (src/features/salidas/SalidaApproval.tsx).
// Same props and the same calls; swap the import in HoyDetail.tsx when lane B lands.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Btn, Chip, ContextQuote, ExactText, Kind, Label } from "@/components/ui/primitives";
import { SplitApprove, useToast } from "@/components/ui/interactive";
import type { Destination, SalidaDetail, SourceState } from "@/lib/domain/types";
import { clock } from "../format";

const SOURCE_NAME = { slack: "Slack", basecamp: "Basecamp", github: "GitHub" } as const;

function destChips(d: Destination): string[] {
  switch (d.kind) {
    case "slack_thread":
      return [d.channel, d.threadLabel ? `Hilo ${d.threadLabel}` : "En el hilo"];
    case "slack_channel":
      return [d.channel];
    case "basecamp_comment":
    case "basecamp_message":
      return [d.project, d.recordingTitle ?? "Comentario"];
    case "basecamp_campfire":
      return [d.project, "Campfire"];
    case "github_review":
      return [`${d.repo}#${d.pr}`, d.event === "APPROVE" ? "Aprobar PR" : "Review"];
    case "github_comment":
      return [`${d.repo}#${d.pr}`, d.path ? `${d.path}${d.line ? `:${d.line}` : ""}` : "Comentario"];
  }
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(e?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function SalidaApproval({ salidaId, compact }: { salidaId: string; compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState<SalidaDetail | null>(null);
  const [down, setDown] = useState<SourceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/salidas/${salidaId}`, { cache: "no-store" });
    if (!res.ok) return setErr("No se pudo cargar la salida.");
    const d = (await res.json()) as SalidaDetail;
    setS(d);
    const h = await fetch(`/api/sources/${d.source}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    const st = (h as { source?: SourceState } | null)?.source;
    setDown(st && st.health === "down" ? st : null);
  }, [salidaId]);

  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => {
      if (live) void load();
    });
    return () => {
      live = false;
    };
  }, [load]);

  if (err) return <p className="hy-note">{err}</p>;
  if (!s) return <div className="hy-skel" aria-busy="true" />;

  const v = s.versions[s.currentVersion - 1] ?? s.versions.at(-1);
  const name = SOURCE_NAME[s.source];

  const act = async (fn: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    try {
      await fn();
      done?.();
      router.refresh();
      await load();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo" });
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    act(
      () => post(`/api/salidas/${s.id}/transition`, { type: "approve", version: s.currentVersion }),
      () =>
        toast({
          text: down ? `Firmada. Sale cuando ${name} vuelva.` : "Enviando en 20 s",
          duration: down ? 5000 : 20000,
          action: down
            ? undefined
            : { label: "Deshacer", onClick: () => void act(() => post(`/api/salidas/${s.id}/transition`, { type: "undo" })) },
        }),
    );
  const deny = () => act(() => post(`/api/salidas/${s.id}/transition`, { type: "deny" }), () => toast({ text: "Salida denegada" }));

  const pending = s.status === "pending";
  const openTurn = s.turns.some((t) => t.state === "open" && t.author === "andres");

  return (
    <div className={compact ? "sa-ap compact" : "sa-ap"}>
      <Kind source={s.source}>Salida · {name}</Kind>
      <h2 className="hy-h2">{s.title || "Respuesta"}</h2>
      <Label>Destino exacto</Label>
      <div className="hy-dest">
        {destChips(s.destination).map((c) => (
          <Chip key={c} source={s.source}>
            {c}
          </Chip>
        ))}
      </div>
      {s.context ? (
        <>
          <Label>Contexto</Label>
          <ContextQuote>{s.context}</ContextQuote>
        </>
      ) : null}
      <Label>Texto que se enviará</Label>
      <ExactText source={s.source}>{v?.body || (s.destination.kind === "github_review" ? "Aprobación sin comentario" : "")}</ExactText>
      <div className="hy-acts">
        {!pending ? (
          <span className="st">{s.status === "sending" ? "Enviando" : s.status === "queued_until_back" ? "Aprobar al volver" : s.status}</span>
        ) : down ? (
          <Btn variant="primary" disabled={busy || openTurn} onClick={approve}>
            Aprobar al volver
          </Btn>
        ) : (
          <SplitApprove version={s.currentVersion} disabled={busy || openTurn} onSend={approve} onSchedule={() => router.push(`/salidas?id=${s.id}`)} />
        )}
        <Link className="btn" href={`/salidas?id=${s.id}`}>
          Editar
        </Link>
        <Btn disabled={busy || !pending} onClick={deny}>
          Denegar
        </Btn>
      </div>
      {down ? (
        <p className="hy-hint">
          {name} no responde{down.lastCheckedAt ? ` desde las ${clock(down.lastCheckedAt)}` : ""}. Si la firmas, sale cuando vuelva.
        </p>
      ) : null}
      <div className="hy-meta">
        <span>
          Redactado por Claude · {clock(v?.createdAt ?? s.createdAt)}
          {s.expiresAt ? ` · caduca ${clock(s.expiresAt)}` : ""}
        </span>
        {s.isSample ? <span>Datos de muestra.</span> : null}
      </div>
    </div>
  );
}
