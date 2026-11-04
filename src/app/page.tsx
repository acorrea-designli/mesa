// Hoy: what waits on Andrés today (line band, rows, detail pane).
import { HoyView } from "@/features/hoy/HoyView";
import { loadHoy } from "@/features/hoy/data";

export default function HoyPage() {
  return <HoyView data={loadHoy()} />;
}
