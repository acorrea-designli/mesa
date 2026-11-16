// View types shared by the Salidas server read model and its client components.
import type { FileState } from "@/lib/domain/salida-files";
import type { SalidaHistoryRow } from "@/lib/domain/salida-queue";
import type { HealthSource, LearnedChip, SalidaDetail, Source } from "@/lib/domain/types";

export interface HistoryEvent {
  at: string;
  source: Source;
  text: string;
  link?: string;
  href?: string;
  evidence?: string;
  /** This salida itself: the last station. */
  now?: boolean;
}

export interface TicketBrief {
  id: string;
  ref: string;
  title: string;
  project: string;
  engramTopic: string;
  engramAt: string | null;
  engramLinked: boolean;
}

export interface SalidaView extends SalidaDetail {
  ticket: TicketBrief | null;
  history: HistoryEvent[];
  /** Web URL of where this salida is published (the permalink after the send); null when it cannot be known. */
  destinationUrl: string | null;
  /** t196: per file of the destination, still the proposed one ("ok"), "changed" or "missing"; empty without files or once final. */
  fileStates?: FileState[];
}

export interface SalidasData {
  /** The queue strip, newest first. */
  items: SalidaView[];
  chips: LearnedChip[];
  sourcesDown: HealthSource[];
  now: string;
  /** t204: the `?s=` salida when it is not in the strip (it opens through the Historial). */
  focus: SalidaView | null;
  /** t204: the `?s=` id when no such salida exists. */
  missing: string | null;
}

/** t204: one page of the Historial (`GET /api/salidas/history`); `next` is the cursor of the following page, null on the last. */
export interface HistoryPage {
  rows: SalidaHistoryRow[];
  next: string | null;
}

export interface EngramObservation {
  id: string | number;
  type: string;
  title: string;
  createdAt: string;
  project?: string;
}

export interface EngramSearch {
  status: "connected" | "offline";
  observations: EngramObservation[];
}
