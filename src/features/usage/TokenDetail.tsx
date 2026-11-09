// "Tokens gastados": today and this week by role and by model, from the Claude Code transcripts. Presentational,
// shown in /semana (#uso) and in /kit. Entrada = fresh input + cache writes, Caché = cache reads, Salida = output.
import { compactTokens, type TokenRow, type TokenSlice, type TokenSummary } from "@/lib/domain/tokens";
import "./usage.css";

function Rows({ title, rows }: { title: string; rows: TokenRow[] }) {
  return (
    <table className="us-table">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="us-sr">{title}</span>
          </th>
          <th scope="col">Entrada</th>
          <th scope="col">Caché</th>
          <th scope="col">Salida</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{r.label}</th>
            <td>{compactTokens(r.use.input + r.use.cacheWrite)}</td>
            <td>{compactTokens(r.use.cacheRead)}</td>
            <td>{compactTokens(r.use.output)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Slice({ title, empty, s }: { title: string; empty: string; s: TokenSlice }) {
  return (
    <div className="us-slice">
      <h3>
        {title} <b>{compactTokens(s.total)}</b>
      </h3>
      {s.total === 0 ? (
        <p className="us-empty">{empty}</p>
      ) : (
        <>
          <Rows title="Por rol" rows={s.byRole} />
          <Rows title="Por modelo" rows={s.byModel} />
        </>
      )}
    </div>
  );
}

export function TokenDetail({ tokens }: { tokens: TokenSummary | null }) {
  return (
    <section id="uso" className="us-detail" aria-label="Tokens gastados">
      <h2>Tokens gastados</h2>
      {tokens ? (
        <>
          <Slice title="Hoy" empty="Sin tokens hoy." s={tokens.today} />
          <Slice title="Esta semana" empty="Sin tokens esta semana." s={tokens.week} />
          <p className="us-note">Días y semana de Bogotá, de las sesiones de Mesa. Caché: lecturas de la caché del prompt.</p>
        </>
      ) : (
        <p className="us-empty">Sin dato: Mesa no encuentra las transcripciones de Claude Code.</p>
      )}
    </section>
  );
}
