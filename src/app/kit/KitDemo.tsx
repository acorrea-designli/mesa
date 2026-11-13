"use client";
import { useState } from "react";
import { BrokenLine, DirectionMarker, Interchange, LineStub, Ring, SourceDot } from "@/components/line/Line";
import { Sheet, SplitApprove, Tabs, useToast } from "@/components/ui/interactive";
import { Btn, Chip, ContextQuote, ExactText, Kind, Label, LinkChip, StatusTag } from "@/components/ui/primitives";
import { ChecklistCard } from "@/features/tickets/ChecklistCard";
import { QuestionCard } from "@/features/tickets/QuestionCard";
import type { Picks } from "@/features/tickets/card";
import { UsageBlock } from "@/features/usage/UsageBlock";
import { Tip } from "@/features/usage/Tip";
import { TIP_PACE, UsoView } from "@/features/usage/UsoView";
import { useIdentity } from "@/components/identity";
import { addUsage, summarize, type Buckets, type Role } from "@/lib/domain/tokens";
import { groupChecklists } from "@/lib/domain/ticket-checklists";
import { SOURCES, type Checklist, type Source, type TicketQuestion, type TicketStep } from "@/lib/domain/types";
import { usageView, type UsagePoint, type UsageSnapshot } from "@/lib/domain/usage";
import { useArrive, useLayLines, usePress } from "@/lib/motion";

type Filter = "all" | Source;

// Uso: fixed sample data, so the gallery renders the same on the server and the client (no clock). A Thursday, 15:00 Bogota.
const USO_NOW = new Date("2026-11-12T20:00:00Z");
const sec = (iso: string) => Date.parse(iso) / 1000;
const USO_SAMPLE: UsageSnapshot = {
  capturedAt: "2026-11-12T19:56:00Z",
  sessionId: "sample",
  model: { id: "claude-opus-5-5", displayName: "Opus 5.5" },
  fiveHour: { usedPercentage: 32, resetsAt: sec("2026-11-12T23:30:00Z") },
  sevenDay: { usedPercentage: 61, resetsAt: sec("2026-11-14T23:30:00Z") },
};
const USO_FRESH = usageView(USO_SAMPLE, USO_NOW);
const USO_STALE = usageView({ ...USO_SAMPLE, capturedAt: "2026-11-12T19:20:00Z" }, USO_NOW);
const USO_NONE = usageView(null, USO_NOW);
/** A believable history: the week climbs in work hours only, the 5 h window climbs with the session. */
const USO_HISTORY: UsagePoint[] = (() => {
  const h: UsagePoint[] = [];
  const weekStart = Date.parse("2026-11-07T23:30:00Z");
  const raw: number[] = [];
  let acc = 0;
  for (let i = 0; weekStart + i * 3_600_000 <= Date.parse("2026-11-12T19:30:00Z"); i++) {
    const hour = new Date(weekStart + i * 3_600_000).getUTCHours();
    acc += hour >= 14 && hour < 23 ? 0.9 + ((i * 7) % 5) * 0.15 : 0;
    raw.push(acc);
  }
  const k = 58 / acc;
  raw.forEach((v, i) => h.push({ t: weekStart + i * 3_600_000, fiveHourUsed: null, sevenDayUsed: Math.round(v * k * 10) / 10 }));
  const fiveStart = Date.parse("2026-11-12T18:30:00Z");
  for (let i = 1; i <= 17; i++) {
    const used = Math.round((2 + 29 * Math.pow(i / 17, 1.25)) * 10) / 10;
    h.push({ t: fiveStart + i * 5 * 60_000, fiveHourUsed: used, sevenDayUsed: 58 + (used / 32) * 2.6 });
  }
  return h.sort((x, y) => x.t - y.t);
})();
const USO_TOKENS = (() => {
  const b: Buckets = {};
  const add = (role: Role, at: string, model: string, input: number, output: number, cacheRead: number) =>
    addUsage(b, role, { at, id: `${role}${at}${model}`, model, use: { input, cacheWrite: Math.round(input / 4), cacheRead, output } });
  add("tl", "2026-11-09T16:00:00Z", "claude-opus-5-5", 2_400_000, 1_100_000, 310_000_000);
  add("dev", "2026-11-09T17:00:00Z", "claude-opus-5-5", 3_100_000, 900_000, 280_000_000);
  add("lead", "2026-11-10T15:00:00Z", "claude-opus-5-5", 800_000, 400_000, 190_000_000);
  add("sweeper", "2026-11-10T16:00:00Z", "claude-haiku-5-5", 1_900_000, 300_000, 150_000_000);
  add("reviewer", "2026-11-11T16:00:00Z", "claude-sonnet-5-5", 1_300_000, 500_000, 120_000_000);
  add("lead", "2026-11-12T14:00:00Z", "claude-opus-5-5", 520_000, 410_000, 68_000_000);
  add("dev", "2026-11-12T15:00:00Z", "claude-opus-5-5", 310_000, 220_000, 31_000_000);
  add("sweeper", "2026-11-12T16:00:00Z", "claude-haiku-5-5", 190_000, 40_000, 8_000_000);
  add("writer", "2026-11-12T17:00:00Z", "claude-sonnet-5-5", 60_000, 30_000, 2_000_000);
  return summarize(b, USO_NOW);
})();
const USO_EMPTY_TOKENS = summarize({}, USO_NOW);

const usoData = (view: typeof USO_FRESH, tokens: typeof USO_TOKENS | null, history: UsagePoint[]) => ({ now: USO_NOW.toISOString(), view, tokens, history });

// A question card in every step state: answered, picked (in the draft), withdrawn and open.
const KIT_Q = (n: number, text: string, extra: Partial<TicketQuestion>): TicketQuestion => ({
  id: `tq_kit${n}`,
  ticketId: "tk_kit",
  messageId: "m_kit",
  n,
  text,
  options: [
    { key: "A", label: "Hoy a las 17:00", detail: "Con lo que está en main" },
    { key: "B", label: "Mañana 09:00", detail: "Entra el fix de Laura" },
    { key: "C", label: "El lunes" },
  ],
  recommended: "B",
  recommendation: "el fix de Laura cierra el bug que vio Matt.",
  state: "open",
  chosen: null,
  answerText: null,
  answerMessageId: null,
  answeredAt: null,
  withdrawReason: null,
  createdAt: "2026-11-11T15:00:00.000Z",
  ...extra,
});
const KIT_CARD = [
  KIT_Q(1, "¿Cuándo corto la release?", { state: "answered", chosen: "B", answerMessageId: "m_kit2", answeredAt: "2026-11-11T15:04:00.000Z" }),
  KIT_Q(2, "¿Quién avisa al cliente?", {
    options: [
      { key: "A", label: "Yo por Slack", detail: "Pasa por Salidas" },
      { key: "B", label: "Tú en la llamada del jueves" },
    ],
    recommended: "A",
    recommendation: "Matt pidió el aviso por escrito.",
  }),
  KIT_Q(3, "¿Subo también el changelog?", { state: "withdrawn", withdrawReason: "ya lo pidió Matt en el hilo" }),
  KIT_Q(4, "¿Qué hago con el flag de exportar?", {
    options: [
      { key: "A", label: "Dejarlo apagado" },
      { key: "B", label: "Encenderlo solo para Scout" },
      { key: "C", label: "Encenderlo para todos" },
      { key: "D", label: "Quitarlo del código" },
    ],
  }),
];
const KIT_ONE = [KIT_Q(1, "", { id: "tq_kit_one", messageId: "m_kit_one" })];

function KitQuestions() {
  const toast = useToast();
  const [picks, setPicks] = useState<Picks>({ tq_kit2: { chosen: "A" } });
  const [one, setOne] = useState<Picks>({});
  const sent = () => toast({ text: "Respuestas enviadas (muestra)" });
  return (
    <div className="kit-line" style={{ alignItems: "flex-start" }}>
      <div className="kit-card">
        <QuestionCard questions={KIT_CARD} picks={picks} onPicks={setPicks} onSend={sent} disabled={false} />
      </div>
      <div className="kit-card">
        <QuestionCard questions={KIT_ONE} picks={one} onPicks={setOne} onSend={sent} disabled={false} />
      </div>
    </div>
  );
}

// A checklist in every step state: done by Andrés, verified by Claude (with its note), open with a Markdown detail
// and code, and open plain. Tapping works on the sample (nothing is saved).
const KIT_STEP = (n: number, text: string, extra: Partial<TicketStep>): TicketStep => ({
  id: `ck_kit${n}`,
  ticketId: "tk_kit",
  messageId: "m_kit_ck",
  n,
  text,
  detail: null,
  state: "open",
  doneBy: null,
  doneAt: null,
  note: null,
  createdAt: "2026-11-12T15:00:00.000Z",
  ...extra,
});
const KIT_STEPS: TicketStep[] = [
  KIT_STEP(1, "Pega la URL iCal en .env.local", {
    state: "done",
    doneBy: "andres",
    doneAt: "2026-11-12T15:10:00.000Z",
    detail: "En Google Calendar: Configuración, tu calendario, **Dirección secreta en formato iCal**.\n\n```\nMESA_ICS_URL=https://calendar.google.com/calendar/ical/...\n```",
  }),
  KIT_STEP(2, "Reinicia Mesa para que lea el archivo", { state: "done", doneBy: "claude", doneAt: "2026-11-12T15:12:00.000Z", note: "Mesa responde configured:true" }),
  KIT_STEP(3, "Autoriza el conector de Google con /mcp", {
    detail: "Abre Claude Code y escribe `/mcp`, elige el conector y acepta el permiso.\n\n- Cuenta: la de Designli\n- Alcance: solo lectura",
  }),
  KIT_STEP(4, "Avísale a Claude cuando esté listo", {}),
];
const kitList = (steps: TicketStep[]): Checklist => groupChecklists(steps)[0]!;

function KitChecklist() {
  const [steps, setSteps] = useState(KIT_STEPS);
  const set = async (s: TicketStep, done: boolean) => {
    await new Promise((r) => setTimeout(r, 250));
    setSteps((xs) => xs.map((x) => (x.id === s.id ? { ...x, state: done ? "done" : "open", doneBy: done ? "andres" : null, doneAt: done ? new Date().toISOString() : null, note: null } : x)));
  };
  const fails = async () => {
    await new Promise((r) => setTimeout(r, 250));
    throw new Error("El ticket está cerrado (muestra del error)");
  };
  return (
    <div className="kit-line" style={{ alignItems: "flex-start" }}>
      <div className="kit-card">
        <ChecklistCard checklist={kitList(steps)} disabled={false} onSet={set} />
      </div>
      <div className="kit-card">
        <ChecklistCard checklist={kitList(KIT_STEPS.slice(0, 2).map((s) => ({ ...s, state: "done", doneBy: s.doneBy ?? "andres", doneAt: s.doneAt ?? "2026-11-12T15:10:00.000Z" })))} disabled onSet={fails} />
      </div>
      <div className="kit-card">
        <ChecklistCard checklist={kitList(KIT_STEPS.slice(2).map((s, i) => ({ ...s, n: i + 1 })))} disabled={false} onSet={fails} />
      </div>
    </div>
  );
}

export function KitDemo() {
  const { ownerName } = useIdentity();
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
        <Label>Tarjeta de preguntas: respondida, elegida, retirada y abierta; y una de un paso</Label>
        <KitQuestions />
      </section>

      <section>
        <Label>Checklist de pasos: hecho por {ownerName}, verificado por Claude, abierto con detalle y código; todo hecho y cerrado; y uno que falla al marcar</Label>
        <KitChecklist />
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
        <Label>Uso: bloque del rail y de Ajustes (con dato, medido hace rato, sin dato)</Label>
        <div className="kit-line" style={{ alignItems: "flex-start" }}>
          {[USO_FRESH, USO_STALE, USO_NONE].map((v, i) => (
            <div key={i} style={{ width: 184, background: "var(--deep)" }}>
              <UsageBlock view={v} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <Label>Uso: ayuda sobre una marca (abierta aquí; en /uso sale al pasar, tocar o enfocar, y se cierra con Escape)</Label>
        <div className="kit-line" style={{ alignItems: "flex-start", paddingTop: 96, paddingLeft: 150 }}>
          <Tip pinned className="us-key" btnClass="us-tip-txt" tip={TIP_PACE}>
            <i aria-hidden="true" /> tiempo que ya pasó
          </Tip>
        </div>
      </section>

      <section>
        <Label>Uso: pantalla /uso con dato</Label>
        <div className="kit-uso">
          <UsoView initial={usoData(USO_FRESH, USO_TOKENS, USO_HISTORY)} live={false} />
        </div>
      </section>

      <section>
        <Label>Uso: pantalla /uso, medición vieja (más de 15 min)</Label>
        <div className="kit-uso">
          <UsoView initial={usoData(USO_STALE, USO_TOKENS, USO_HISTORY)} live={false} />
        </div>
      </section>

      <section>
        <Label>Uso: pantalla /uso sin dato (ejes y líneas punteadas)</Label>
        <div className="kit-uso">
          <UsoView initial={usoData(USO_NONE, USO_EMPTY_TOKENS, [])} live={false} />
        </div>
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
