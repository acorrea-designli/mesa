// Shared domain types. These are the shapes the API returns and the UI renders.
// Keep them free of server-only imports so client components can use them.

export const SOURCES = ["github", "slack", "basecamp", "claude"] as const;
export type Source = (typeof SOURCES)[number];

/** Stations of the line: the kanban statuses, in order. */
export const STATIONS = ["inbox", "todo", "doing", "waiting", "done"] as const;
export type Station = (typeof STATIONS)[number];

export const STATION_LABEL: Record<Station, string> = {
  inbox: "Inbox",
  todo: "Todo",
  doing: "En curso",
  waiting: "Esperando",
  done: "Hecho",
};

/** GitHub Project "Status" option names, one per station. */
export const STATION_GH_STATUS: Record<Station, string> = {
  inbox: "Inbox",
  todo: "Todo",
  doing: "In Progress",
  waiting: "Waiting",
  done: "Done",
};

export const SOURCE_LABEL: Record<Source, string> = {
  github: "GitHub",
  slack: "Slack",
  basecamp: "Basecamp",
  claude: "Claude",
};

/** Who an item or task waits on. "you" = Andrés. Free text after "person:" is a name. */
export type WaitOn = "you" | "client" | "claude" | "none" | `person:${string}`;

export interface Item {
  id: string;
  source: Source;
  externalId: string;
  kind: string; // pr_review | request | mention | message | question
  title: string;
  excerpt: string;
  project: string;
  url: string | null;
  need: string; // reply | approve_pr | decision | approve
  station: Station;
  waitOn: WaitOn;
  tag: string | null; // e.g. "clean" for a PR the monitor found clean
  taskId: string | null;
  meta: Record<string, unknown>;
  isSample: boolean;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type SyncState = "synced" | "pending" | "error" | "local";

export interface Task {
  id: string;
  title: string;
  excerpt: string;
  project: string;
  source: Source; // lane on Tablero B
  station: Station;
  waitOn: WaitOn;
  position: number;
  ghItemId: string | null;
  ghContentUrl: string | null;
  syncState: SyncState;
  syncError: string | null;
  syncedAt: string | null;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  /** Items linked to this task (chips on the card). Filled by the repository. */
  items?: Pick<Item, "id" | "source" | "title" | "url" | "project">[];
}

// ---------- tickets ----------

export type TicketDirection = "claude_asks" | "andres_asks";
export type TicketStatus = "waiting_andres" | "waiting_claude" | "working" | "closed";
export type Author = "andres" | "claude";

export interface TicketOption {
  key: string; // "A", "B", ...
  label: string;
  detail?: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  author: Author;
  body: string;
  options: TicketOption[] | null;
  recommended: string | null;
  recommendation: string | null;
  chosen: string | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  ticketId: string;
  messageId: string | null;
  filename: string;
  mime: string;
  size: number;
  path: string;
  createdAt: string;
}

export type RefType = "ticket" | "item" | "url";
export interface TicketRef {
  id: string;
  ticketId: string;
  messageId: string | null;
  refType: RefType;
  target: string;
  label: string;
  createdAt: string;
}

export type ActionMode = "direct" | "needs_ok";
export type ActionState = "planned" | "approved" | "rejected" | "running" | "done" | "failed";
export interface PlannedAction {
  id: string;
  ticketId: string;
  seq: number;
  kind: string;
  source: Source;
  label: string;
  mode: ActionMode;
  state: ActionState;
  target: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  id: string;
  ref: string; // short code used in @ references, e.g. "t17"
  direction: TicketDirection;
  title: string;
  status: TicketStatus;
  project: string;
  ownerSession: string | null;
  itemId: string | null;
  isSample: boolean;
  wokeAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
  attachments: Attachment[];
  refs: TicketRef[];
  actions: PlannedAction[];
  engram: EngramLink[];
}

// ---------- salidas ----------

export type SalidaStatus =
  | "draft"
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "denied"
  | "expired"
  | "scheduled"
  | "deleted";

export type SalidaSource = "slack" | "basecamp";

export type Destination =
  | {
      kind: "slack_thread" | "slack_channel";
      workspace: string;
      channel: string; // "#scout-dev"
      channelId?: string;
      threadTs?: string;
      threadLabel?: string; // "Hilo 09:31 · Matt"
      postAs: string; // "Andrés Correa"
    }
  | {
      kind: "basecamp_comment" | "basecamp_campfire" | "basecamp_message";
      project: string;
      projectId?: string;
      recordingId?: string;
      recordingTitle?: string;
      postAs: string;
    };

export type DestinationKind = Destination["kind"];

/** What Mesa can do after a message is sent, per destination kind. */
export const DELETE_POLICY: Record<DestinationKind, "trash" | "permanent" | "none"> = {
  slack_thread: "none", // the Slack connector has no delete tool
  slack_channel: "none",
  basecamp_comment: "trash", // recoverable 25 days
  basecamp_message: "trash",
  basecamp_campfire: "permanent",
};

export interface SalidaLink {
  source: Source;
  label: string;
  url?: string;
}

export interface Salida {
  id: string;
  status: SalidaStatus;
  source: SalidaSource;
  destination: Destination;
  title: string;
  context: string;
  ticketId: string | null;
  links: SalidaLink[];
  ownerSession: string | null;
  currentVersion: number;
  approvedVersion: number | null;
  undoUntil: string | null;
  releasedAt: string | null;
  sendAt: string | null;
  expiresAt: string | null;
  sentAt: string | null;
  permalink: string | null;
  error: string | null;
  deleteRequestedAt: string | null;
  deletedAt: string | null;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SalidaVersion {
  id: string;
  salidaId: string;
  n: number;
  body: string;
  author: "claude" | "andres";
  turnId: string | null;
  starred: boolean;
  createdAt: string;
}

export type MarkKind = "keep" | "redo" | "drop";
export interface Mark {
  start: number;
  end: number;
  kind: MarkKind;
  text: string;
}

export interface SalidaTurn {
  id: string;
  salidaId: string;
  author: Author;
  body: string;
  marks: Mark[];
  onVersion: number;
  state: "open" | "answered" | "cancelled";
  chipLabel: string | null;
  createdAt: string;
}

export interface SalidaDetail extends Salida {
  versions: SalidaVersion[];
  turns: SalidaTurn[];
  engram: EngramLink[];
}

export interface LearnedChip {
  label: string;
  phrasings: string[];
  uses: number;
  lastUsedAt: string;
}

// ---------- sessions, wake, engram ----------

export interface Session {
  id: string;
  label: string;
  cwd: string;
  project: string;
  cursor: number;
  waitingSince: string | null;
  lastSeenAt: string;
  createdAt: string;
}

export type WakeKind =
  | "ticket.created" // Andrés opened a request (broadcast)
  | "ticket.answered" // Andrés replied or chose an option
  | "ticket.plan_approved"
  | "ticket.closed"
  | "ticket.reopened"
  | "salida.turn" // Andrés asked for a change
  | "salida.released" // undo window over: send now
  | "salida.undone"
  | "salida.denied"
  | "salida.delete_requested"
  | "salida.restore_requested"
  | "task.moved";

export interface WakeEvent {
  id: number;
  sessionId: string | null;
  kind: WakeKind;
  entityType: "ticket" | "salida" | "task";
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface EngramLink {
  id: string;
  entityType: "ticket" | "salida" | "task";
  entityId: string;
  project: string;
  topicKey: string | null;
  observationId: string | null;
  createdAt: string;
}

/** Rail and tab counts. */
export interface Counts {
  hoy: number;
  tablero: number;
  tickets: number;
  salidas: number;
  doneToday: number;
  stations: Record<Station, number>;
}
