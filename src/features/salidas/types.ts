// View types shared by the Salidas server read model and its client components.
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
}

export interface SalidasData {
  items: SalidaView[];
  chips: LearnedChip[];
  sourcesDown: HealthSource[];
  now: string;
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
