import { BrokenLine, LineStub } from "../line/Line";
import type { SourceHealth } from "./health";

/** "Fuentes": one row per source, a line stub when it is fine and a broken line when it is not. Shared by the rail (desktop) and the Ajustes sheet (phone). */
export function SourceHealthList({ health }: { health: (SourceHealth & { name: string })[] }) {
  if (!health.length) return null;
  return (
    <div className="rl-health" role="status" aria-label="Fuentes">
      <div className="k">Fuentes</div>
      {health.map((h) => {
        const line = h.source === "github_project" || h.source === "github_projects" ? "github" : h.source;
        return (
          <div key={h.source} className={h.state === "ok" ? "rl-src" : "rl-src bad"}>
            {h.state === "ok" ? <LineStub source={line} width={16} /> : <BrokenLine source={line} width={24} title={`${h.name} ${h.note}`} />}
            <span className="rl-src-name">{h.name}</span>
            <small>{h.note}</small>
          </div>
        );
      })}
    </div>
  );
}
