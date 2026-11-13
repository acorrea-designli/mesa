// The project's line (Mapa de metro): stations = the board's Status columns, one GitHub-red line per repo labelled at
// the left, a tick per PR (filled = te toca, dashed = draft), an interchange ring for an issue in two repos, a short ink
// bar over a tick with an open blocker of his, the "Sin issue" spur and the dashed "Tren a staging". Laid out by
// model.ts; this only draws. Dotted lines while GitHub is limited.
import Link from "next/link";
import type { BandModel, BandStop, BandTick, CorridorModel } from "./model";

const FONT = "var(--font-hanken), 'Hanken Grotesk', sans-serif";

function Tick({ t }: { t: BandTick }) {
  return (
    <>
      {t.ring ? (
        <circle cx={t.x} cy={t.y} r={7} className="pj-ring">
          <title>{t.title}</title>
        </circle>
      ) : (
        <circle cx={t.x} cy={t.y} r={5} className={["pj-tick", t.you && "you", t.draft && "draft"].filter(Boolean).join(" ")}>
          <title>{`${t.title}${t.you ? " · te toca" : ""}${t.draft ? " · borrador" : ""}`}</title>
        </circle>
      )}
      {t.blocker ? <path d={`M${t.x - 5} ${t.y - 13}h10`} className="pj-ln pj-ink" style={{ strokeWidth: 2.5 }} /> : null}
    </>
  );
}

function Stop({ s, labelY }: { s: BandStop; labelY: number }) {
  return (
    <g>
      {s.connector ? <path d={`M${s.connector.x} ${s.connector.y1}V${s.connector.y2}`} className="pj-ln pj-ink" style={{ strokeWidth: 3 }} /> : null}
      {s.ticks.map((t) => (
        <Tick key={`${t.title}-${t.x}`} t={t} />
      ))}
      <text x={s.x - 8} y={labelY} fontSize={12} fontWeight={700} className="pj-txt">
        {s.label}
      </text>
    </g>
  );
}

export function Band({ band: b }: { band: BandModel }) {
  const ys = b.lines.map((l) => l.y);
  const lastY = Math.max(...ys);
  return (
    <svg width={b.W} height={b.H} viewBox={`0 0 ${b.W} ${b.H}`} fontFamily={FONT} role="group" aria-label="Línea del proyecto" className="pj-svg">
      {b.lines.map((l) => (
        <text key={`l-${l.label}`} x={0} y={l.y + 4} fontSize={12.5} fontWeight={600} className="pj-mute">
          {l.label}
        </text>
      ))}
      <g>
        {b.lines.map((l) => (
          <path key={`p-${l.label}`} d={`M${b.L} ${l.y}H${b.W}`} className={["pj-ln pj-gh", b.dotted && "pj-dot", (b.empty || l.quiet) && "pj-dim"].filter(Boolean).join(" ")} style={{ strokeWidth: 5 }} />
        ))}
      </g>
      {b.spur ? (
        <Link href={b.spur.href} scroll={false} aria-label={`Sin issue: ${b.spur.note}`} className={b.spur.on ? "pj-hit" : "pj-hit pj-dim"}>
          <path d={b.spur.d} className={["pj-ln pj-gh", b.dotted && "pj-dot"].filter(Boolean).join(" ")} style={{ strokeWidth: 5 }} />
          {b.spur.ticks.map((t) => (
            <Tick key={`s-${t.title}`} t={t} />
          ))}
          {b.spur.more ? (
            <text x={b.spur.more.x} y={lastY + 72} fontSize={12} fontWeight={700} className="pj-txt">
              {b.spur.more.text}
            </text>
          ) : null}
          <text x={b.spur.labelX} y={lastY + 72} fontSize={13} fontWeight={700} className="pj-txt">
            Sin issue
          </text>
          <text x={b.spur.noteX} y={lastY + 72} fontSize={12.5} fontWeight={600} className="pj-mute">
            {b.spur.note}
          </text>
        </Link>
      ) : null}
      {b.train ? (
        <Link href={b.train.href} scroll={false} aria-label={`Tren a staging: ${b.train.note}`} className={b.train.on ? "pj-hit" : "pj-hit pj-dim"}>
          <path d={b.train.d} className="pj-ln pj-gh pj-trainln" style={{ strokeWidth: 5 }} />
          {b.train.ticks.map((t) => (
            <Tick key={`t-${t.title}`} t={t} />
          ))}
          <text x={b.train.labelX} y={lastY + 72} fontSize={13} fontWeight={700} className="pj-txt">
            Tren a staging
          </text>
          {b.train.note ? (
            <text x={b.train.noteX} y={lastY + 72} fontSize={12.5} fontWeight={600} className="pj-mute">
              {b.train.note}
            </text>
          ) : null}
        </Link>
      ) : null}
      {b.stations.map((s) => (
        <Link key={s.key} href={s.href} scroll={false} aria-label={`${s.name}: ${s.count}`} aria-current={s.on ? "true" : undefined} className="pj-hit">
          <text x={s.x} y={20} fontSize={15} fontWeight={700} className="pj-txt" opacity={s.quiet && !s.on ? 0.6 : 1}>
            {s.name}
          </text>
          <text x={s.x} y={38} fontSize={12.5} fontWeight={600} className="pj-mute">
            {s.count}
          </text>
          <rect x={s.x} y={b.capTop} width={22} height={b.capH} rx={11} className={s.on ? "pj-cap on" : "pj-cap"} strokeDasharray={s.dashed ? "4 4" : undefined} />
          {s.on ? <path d={`M${s.x - 4} ${b.capTop + b.capH + 12}h30`} className="pj-ln pj-ink" style={{ strokeWidth: 3 }} /> : null}
        </Link>
      ))}
      {b.stops.map((g) => (
        <g key={`g-${g.station}`} className={g.dim ? "pj-dim" : undefined}>
          {g.stops.map((s) => (
            <Stop key={s.label} s={s} labelY={b.labelY} />
          ))}
          {g.more ? (
            <text x={g.more.x} y={b.labelY} fontSize={12} fontWeight={700} className="pj-mute">
              {g.more.text}
            </text>
          ) : null}
        </g>
      ))}
      {b.legend ? (
        <g transform={`translate(${b.W - 372},${b.H - 6})`} fontSize={12} fontWeight={600} className="pj-mute">
          <circle cx={5} cy={-4} r={5} className="pj-tick" />
          <text x={16} y={0}>
            PR
          </text>
          <circle cx={50} cy={-4} r={5} className="pj-tick you" />
          <text x={61} y={0}>
            te toca
          </text>
          <circle cx={124} cy={-4} r={6} className="pj-ring" />
          <text x={136} y={0}>
            issue en 2 repos
          </text>
          <path d="M252 -12h10" className="pj-ln pj-ink" style={{ strokeWidth: 2.5 }} />
          <text x={268} y={0}>
            bloqueante
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/** The phone's band: the selected station's corridor, its neighbours named at the edges. */
export function Corridor({ c }: { c: CorridorModel }) {
  return (
    <svg width="100%" height={c.H} viewBox={`0 0 ${c.W} ${c.H}`} preserveAspectRatio="xMinYMin meet" fontFamily={FONT} role="group" aria-label={`Corredor de ${c.name}`} className="pj-svg">
      {c.prev ? (
        <Link href={c.prev.href} scroll={false} className="pj-hit">
          <text x={18} y={22} fontSize={12} fontWeight={600} className="pj-mute">
            ‹ {c.prev.name}
          </text>
        </Link>
      ) : null}
      {c.next ? (
        <Link href={c.next.href} scroll={false} className="pj-hit">
          <text x={c.W - 18} y={22} fontSize={12} fontWeight={600} className="pj-mute" textAnchor="end">
            {c.next.name} ›
          </text>
        </Link>
      ) : null}
      <text x={c.W / 2} y={22} fontSize={15} fontWeight={700} className="pj-txt" textAnchor="middle">
        {c.name}
      </text>
      {c.lines.map((l) => (
        <path key={l.y} d={`M0 ${l.y}H${c.W}`} className={["pj-ln pj-gh", c.dotted && "pj-dot", l.quiet && "pj-dim"].filter(Boolean).join(" ")} style={{ strokeWidth: 5 }} />
      ))}
      <rect x={c.cap.x} y={c.cap.y} width={22} height={c.cap.h} rx={11} className="pj-cap on" />
      {c.stops.map((s) => (
        <Stop key={s.label} s={s} labelY={c.labelY} />
      ))}
      {c.more ? (
        <text x={c.more.x} y={c.labelY} fontSize={12} fontWeight={700} className="pj-mute">
          {c.more.text}
        </text>
      ) : null}
    </svg>
  );
}
