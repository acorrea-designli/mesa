// "Ver tabla completa": the table view of the charts. One aligned table for a period: entrada (fresh input + cache
// writes), caché (cache reads) and salida (output), by role and by model. Presentational.
import { compactTokens, exactTokens, type TokenRow, type TokenSlice } from "@/lib/domain/tokens";
import "./usage.css";

function Group({ title, rows, id }: { title: string; rows: TokenRow[]; id?: boolean }) {
  return (
    <tbody>
      <tr className="grp">
        <th scope="colgroup" colSpan={4}>
          {title}
        </th>
      </tr>
      {rows.map((r) => (
        <tr key={r.key} title={id ? r.key : undefined}>
          <th scope="row">{r.label}</th>
          <td title={exactTokens(r.use.input + r.use.cacheWrite)}>{compactTokens(r.use.input + r.use.cacheWrite)}</td>
          <td title={exactTokens(r.use.cacheRead)}>{compactTokens(r.use.cacheRead)}</td>
          <td title={exactTokens(r.use.output)}>{compactTokens(r.use.output)}</td>
        </tr>
      ))}
    </tbody>
  );
}

export function TokenTable({ slice }: { slice: TokenSlice }) {
  return (
    <details className="us-more">
      <summary>Ver tabla completa</summary>
      <table className="us-table">
        <caption className="us-sr">Tokens por rol y por modelo: entrada, caché y salida</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="us-sr">Rol o modelo</span>
            </th>
            <th scope="col">Entrada</th>
            <th scope="col">Caché</th>
            <th scope="col">Salida</th>
          </tr>
        </thead>
        <Group title="Por rol" rows={slice.byRole} />
        <Group title="Por modelo" rows={slice.byModel} id />
      </table>
    </details>
  );
}
