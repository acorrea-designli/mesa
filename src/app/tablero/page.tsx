// Tablero B (lanes by source), mirrored to the private GitHub Project.
import type { Metadata } from "next";
import { TableroView } from "@/features/tablero/TableroView";
import { loadTablero } from "@/features/tablero/data";

export const metadata: Metadata = { title: "Tablero" };

export default function TableroPage() {
  return <TableroView data={loadTablero()} />;
}
