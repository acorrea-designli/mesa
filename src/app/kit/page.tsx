// Design system gallery for the lanes: every shared component in one place.
import type { Metadata } from "next";
import { ScreenFrame } from "@/components/shell/ScreenFrame";
import "@/features/tickets/tickets.css";
import { KitDemo } from "./KitDemo";
import "./kit.css";

export const metadata: Metadata = { title: "Kit" };

export default function KitPage() {
  return (
    <ScreenFrame title="Kit" meta="Componentes compartidos">
      <KitDemo />
    </ScreenFrame>
  );
}
