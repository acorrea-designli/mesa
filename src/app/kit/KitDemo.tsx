"use client";
import { useState } from "react";
import { BrokenLine, DirectionMarker, Interchange, LineStub, Ring, SourceDot } from "@/components/line/Line";
import { Sheet, SplitApprove, Tabs, useToast } from "@/components/ui/interactive";
import { Btn, Chip, ContextQuote, ExactText, Kind, Label, LinkChip, StatusTag } from "@/components/ui/primitives";
import { TokenDetail } from "@/features/usage/TokenDetail";
import { UsageBlock } from "@/features/usage/UsageBlock";
import { addUsage, summarize, type Buckets, type Role } from "@/lib/domain/tokens";
import { SOURCES, type Source } from "@/lib/domain/types";
import { usageView, type UsageSnapshot } from "@/lib/domain/usage";
import { useArrive, useLayLines, usePress } from "@/lib/motion";

type Filter = "all" | Source;

// Uso: fixed sample data, so the gallery renders the same on the server and the client (no clock).
const USO_NOW = new Date("2026-11-09T20:00:00Z");
const sec = (iso: string) => Date.parse(iso) / 1000;
const USO_SAMPLE: UsageSnapshot = {
  capturedAt: "2026-11-09T19:56:00Z",
  sessionId: "sample",
  model: { id: "claude-opus-5-5", displayName: "Opus 5.5" },
  fiveHour: { usedPercentage: 32, resetsAt: sec("2026-11-09T23:30:00Z") },
  sevenDay: { usedPercentage: 61, resetsAt: sec("2026-11-14T23:30:00Z") },
};
const USO_FRESH = usageView(USO_SAMPLE, USO_NOW);
const USO_STALE = usageView({ ...USO_SAMPLE, capturedAt: "2026-11-09T19:20:00Z" }, USO_NOW);
const USO_NONE = usageView(null, USO_NOW);
const USO_TOKENS = (() => {
  const b: Buckets = {};
  const add = (role: Role, at: string, model: string, input: number, output: number, cacheRead: number) =>
    addUsage(b, role, { at, id: `${role}${at}`, model, use: { input, cacheWrite: Math.round(input / 4), cacheRead, output } });
  add("lead", "2026-11-09T14:00:00Z", "claude-opus-5-5", 52_000, 41_000, 6_800_000);
  add("dev", "2026-11-09T15:00:00Z", "claude-opus-5-5", 31_000, 22_000, 3_100_000);
  add("sweeper", "2026-11-09T16:00:00Z", "claude-haiku-5-5", 9_000, 4_000, 800_000);
  add("lead", "2026-11-05T16:00:00Z", "claude-opus-5-5", 180_000, 120_000, 21_000_000);
  return summarize(b, USO_NOW);
})();

export function KitDemo() {
  const [tab, setTab] = useState<Filter>("all");
  const [sheet, setSheet] = useState(false);
  const toast = useToast();
  const svg = useLayLines<SVGSVGElement>();
  const list = useArrive<HTMLDivElement>(".kit-row", tab);
  const press = usePress<HTMLDivElement>(".btn, .tab, .chip");

  return (
    <div className="kit" ref={press}>
      <section>
        <Label>Botones</Label>
        <div className="kit-line">
          <Btn variant="primary">Responder</Btn>
          <Btn>Editar</Btn>
          <Btn>Denegar</Btn>
          <Btn size="sm">Pequeño</Btn>
          <Btn disabled>Deshabilitado</Btn>
          <SplitApprove
            version={3}
            onSend={() => toast({ text: "Enviando en 20 s", action: { label: "Deshacer", onClick: () => toast({ text: "Deshecho" }) } })}
            onSchedule={() => setSheet(true)}
          />
        </div>
      </section>

      <section>
        <Label>Pestañas por fuente</Label>
        <Tabs<Filter>
          label="Fuente"
          value={tab}
          onChange={setTab}
          items={[{ key: "all", label: "Todo" }, ...SOURCES.map((s) => ({ key: s, label: s[0]!.toUpperCase() + s.slice(1), source: s }))]}
        />
        <div ref={list} className="kit-list">
          {[1, 2, 3].map((i) => (
            <div key={i} className="kit-row">
              Fila de muestra {i}
            </div>
          ))}
        </div>
      </section>

      <section>
        <Label>Chips y estados</Label>
        <div className="kit-line">
          <Chip source="slack">#scout-dev</Chip>
          <Chip source="basecamp">Basecamp · Scout</Chip>
          <Chip source="github">PR #59</Chip>
          <Chip variant="plain">Neutral</Chip>
          <Chip variant="ref">@t17</Chip>
          <LinkChip source="github">PR #212</LinkChip>
          <LinkChip source="slack">Slack #scout-dev</LinkChip>
        </div>
        <div className="kit-line">
          <StatusTag tone="you">Te espera</StatusTag>
          <StatusTag tone="you">Por enviar</StatusTag>
          <StatusTag tone="ok">Limpio</StatusTag>
          <StatusTag tone="cl">Espera a Claude</StatusTag>
          <StatusTag>Espera al cliente</StatusTag>
          <StatusTag tone="off">Sin datos</StatusTag>
        </div>
      </section>

      <section>
        <Label>Líneas</Label>
        <div className="kit-line">
          {SOURCES.map((s) => (
            <span key={s} className="kit-line">
              <SourceDot source={s} />
              <LineStub source={s} width={40} />
              <LineStub source={s} width={40} dim />
            </span>
          ))}
        </div>
        <div className="kit-line">
          <Ring />
          <Ring source="claude" />
          <Interchange from="basecamp" to="github" />
          <DirectionMarker direction="claude_asks" />
          <DirectionMarker direction="andres_asks" />
          <BrokenLine source="slack" />
        </div>
        <svg ref={svg} width="100%" height="90" viewBox="0 0 640 90" role="img" aria-label="Muestra de la banda" className="kit-band">
          <g fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 24H300l20-20H620" className="s-gh" />
            <path d="M20 44H620" className="s-sl" />
            <path d="M20 64H400l20 20H620" className="s-bc" />
          </g>
          <rect x="140" y="12" width="28" height="66" rx="14" className="sv-cap on" />
          <rect x="460" y="12" width="28" height="66" rx="14" className="sv-cap" />
          <circle cx="80" cy="24" r="5" className="f-gh sv-tick" />
          <circle cx="100" cy="44" r="5" className="f-sl sv-tick" />
          <circle cx="240" cy="64" r="8.5" className="sv-ring" />
        </svg>
      </section>

      <section>
        <Label>Texto exacto</Label>
        <Kind source="slack">Salida · Slack</Kind>
        <ContextQuote>Matt: andres can you confirm the env var before 2pm?</ContextQuote>
        <ExactText source="slack">
          Confirmed, <mark className="m-keep">SCOUT_API_URL</mark> is set on staging. <mark className="m-redo">Prod</mark>{" "}
          <mark className="m-drop">tentatively</mark> after 2pm.
        </ExactText>
      </section>

      <section>
        <Label>Uso</Label>
        <div className="kit-line" style={{ alignItems: "flex-start" }}>
          {[USO_FRESH, USO_STALE, USO_NONE].map((v, i) => (
            <div key={i} style={{ width: 184 }}>
              <UsageBlock view={v} />
            </div>
          ))}
        </div>
        <TokenDetail tokens={USO_TOKENS} />
      </section>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Programar salida">
        {["Hoy 16:00", "mié 9:00", "mar 9:00"].map((t) => (
          <Btn key={t} size="phone" onClick={() => setSheet(false)}>
            {t}
          </Btn>
        ))}
      </Sheet>
      <p className="kit-note">Datos de muestra.</p>
    </div>
  );
}
