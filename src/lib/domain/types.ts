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
  /** Most specific stable project id (generated column items.project_key; domain/ignore.ts projectKey). */
  projectKey?: string;
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
  /** Its lane's linked item key, else project (filled by the repository; domain/ignore.ts). */
  projectKey?: string;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  /** The ticket Claude works this card in ("Dárselo a Claude"); null for a note-only card. */
  ticketId: string | null;
  /** Items linked to this task (chips on the card). Filled by the repository. */
  items?: Pick<Item, "id" | "source" | "title" | "url" | "project">[];
  /** Who works the linked ticket (the owner chip). Filled by the repository; null without a ticket. */
  owner?: TaskOwner | null;
}

/** The linked ticket of a card and its owner agent (ticket_team, owner = 1, live). */
export interface TaskOwner {
  ticketId: string;
  ticketRef: string;
  ticketStatus: TicketStatus;
  /** Live owner agent ("tl-t21"); null until the lead claims the ticket and spawns one. */
  agent: string | null;
  role: string | null;
}

/** What a ticket.created wake hints to the lead for triage (docs/TEAM.md § 4). */
export type DispatchKind = "review" | "request" | "investigation" | "reply";
export const DISPATCH_KINDS: readonly DispatchKind[] = ["review", "request", "investigation", "reply"];

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
  /** "permission_request" for the "Pídeme permiso" message; null for every ordinary message. */
  kind: "permission_request" | null;
  /** For a permission request: the latest Claude message when he pressed the button. */
  aboutMessageId: string | null;
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
  /** The board card this ticket works (tasks.ticket_id points back). */
  taskId: string | null;
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
  | "queued_until_back" // approved while the source was down ("Aprobar al volver")
  | "deleted";

export type SalidaSource = "slack" | "basecamp" | "github";

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
    }
  | {
      /** A PR review (approve or comment) or an inline/PR comment, written with gh by the lead. */
      kind: "github_review" | "github_comment";
      repo: string; // owner/name
      pr: number;
      event?: "APPROVE" | "COMMENT" | "REQUEST_CHANGES"; // github_review
      path?: string; // github_comment inline
      line?: number;
      commitId?: string;
      findingN?: number;
      /** Reply inside an existing review thread (the comment id to answer). */
      inReplyTo?: string;
      /** github_review: inline comments posted as ONE batched review. Their bodies are the exact text. */
      comments?: GithubReviewComment[];
      postAs: string;
    };

export interface GithubReviewComment {
  path?: string;
  line?: number;
  body: string;
  findingN?: number;
  inReplyTo?: string;
}

export type DestinationKind = Destination["kind"];

/** What Mesa can do after a message is sent, per destination kind. */
export const DELETE_POLICY: Record<DestinationKind, "trash" | "permanent" | "none"> = {
  slack_thread: "none", // the Slack connector has no delete tool
  slack_channel: "none",
  basecamp_comment: "trash", // recoverable 25 days
  basecamp_message: "trash",
  basecamp_campfire: "permanent",
  github_review: "none", // a submitted review cannot be deleted
  github_comment: "permanent",
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
  /** "Abrir destino": where this salida is published (the permalink once sent). Set by the read model and the salida API; null when unknowable. */
  destinationUrl?: string | null;
}

export interface LearnedChip {
  label: string;
  phrasings: string[];
  uses: number;
  /** Sample data from `pnpm seed`. */
  isSample: boolean;
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
  | "ticket.created" // Andrés opened a request or handed a card to Claude: { ref, ticketRef, taskId, kind? }
  | "ticket.answered" // Andrés replied or chose an option
  | "ticket.plan_approved"
  | "ticket.closed"
  | "ticket.reopened"
  | "ticket.permission_requested" // "Pídeme permiso": { ref, ticketRef, messageId }; the agent files the approval card (docs/TEAM.md section 6)
  | "salida.turn" // Andrés asked for a change
  | "salida.released" // undo window over: send now
  | "salida.undone"
  | "salida.denied"
  | "salida.delete_requested"
  | "salida.restore_requested"
  | "salida.queued" // approved while the source is down
  | "review.action" // Andrés pressed Approve / Approve anyway / Post / Dismiss / Explain more
  | "sweep.requested" // "Barrer ahora": run the mesa-sweep skill
  | "task.moved";

export interface WakeEvent {
  id: number;
  sessionId: string | null;
  kind: WakeKind;
  entityType: "ticket" | "salida" | "task" | "review" | "sweep";
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
  approvals: number; // pending permission approvals
  doneToday: number;
  stations: Record<Station, number>;
}

// ---------- ephemeral agents ----------

/** The living summary of a ticket. Updated by its owner on every milestone. */
export interface Brief {
  ticketId: string;
  body: string;
  goal: string;
  decisions: string[];
  planStep: string;
  openQuestions: string[];
  nextAction: string;
  revision: number;
  updatedBy: string;
  updatedAt: string;
}

export type HandoffStatus = "done" | "paused" | "blocked";
export interface Handoff {
  id: string;
  ticketId: string;
  ticketRef: string;
  agent: string;
  role: string;
  status: HandoffStatus;
  body: string;
  done: string;
  remaining: string;
  artifacts: { branch?: string; pr?: string; files?: string[]; [k: string]: unknown };
  createdAt: string;
}

export interface TeamAgent {
  name: string;
  ticketId: string;
  ticketRef: string;
  role: string;
  owner: boolean;
  status: "live" | "retired";
  spawnedAt: string;
  retiredAt: string | null;
}

// ---------- permission approvals ----------

export type ApprovalDecision = "allow" | "read_config" | "deny";
export interface Approval {
  id: string;
  ticketId: string | null;
  ticketRef: string | null;
  agent: string;
  tool: string;
  summary: string;
  detail: string;
  cwd: string;
  hints: string[];
  status: "pending" | "decided" | "expired";
  decision: ApprovalDecision | null;
  note: string;
  decidedBy: string | null;
  decidedAt: string | null;
  expiresAt: string;
  /** Sample data from `pnpm seed` ("Datos de muestra."). */
  isSample: boolean;
  createdAt: string;
}

// ---------- reviews ----------

export type FindingState = "open" | "fixed" | "waived" | "dismissed";
export interface Finding {
  id: string;
  reviewId: string;
  repo: string;
  pr: number;
  n: number;
  label: "blocker" | "nit" | "comment";
  at: string;
  anchor: string;
  summary: string;
  explanation: string;
  state: FindingState;
  sha: string;
  ghCommentId: string | null;
  salidaId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  ticketId: string | null;
  repo: string;
  pr: number;
  /** The reviewed head: only `review open` moves it. */
  headSha: string;
  /** The newest PR head seen after a push on a closed ticket (where an incremental re-review ends); empty until then. */
  seenHead: string;
  state: "open" | "approving" | "approved";
  salidaId: string | null;
  createdAt: string;
  updatedAt: string;
  findings: Finding[];
}

export type ReviewAction = "approve" | "approve_anyway" | "post" | "dismiss" | "explain";

// ---------- sources: sweep state and health ----------

export type HealthSource = "github" | "github_project" | "slack" | "basecamp" | "engram";
/** Per-source sweep state and health (one row per source). */
export interface SourceState {
  source: HealthSource;
  health: "ok" | "degraded" | "down";
  note: string;
  watermark: string | null;
  lastChecked: string | null;
  lastNewAt: string | null;
  backoffUntil: string | null;
  cadenceS: number;
  errorCount: number;
  lastError: string | null;
  updatedAt: string;
}

/** GET /api/sources: sweep state keyed by source, plus Andrés's last UI action. */
export interface SourcesPayload {
  sources: Partial<Record<HealthSource, SourceState>>;
  lastInteractionAt: string | null;
}

// ---------- resume payload ----------

/** Everything a fresh agent needs to resume a ticket, in one compact payload. */
export interface TicketContext {
  ticket: Ticket;
  brief: Brief | null;
  plan: PlannedAction[];
  messages: TicketMessage[]; // last N, oldest first
  openQuestions: string[];
  team: TeamAgent[];
  handoffs: Handoff[]; // latest per agent, newest first
  latestHandoff: Handoff | null;
  approvals: Approval[]; // pending
  salidas: Pick<Salida, "id" | "status" | "source" | "title" | "currentVersion">[]; // not final
  findings: Finding[];
  /** The PR reviews of this ticket, without findings (see `findings`): headSha = reviewed head, seenHead = newest head seen after a push. */
  reviews: Omit<Review, "findings">[];
  engram: { topicKey: string; project: string; links: EngramLink[] };
}

/** Engram topic key for a ticket: every ticket thread is saved under it. */
export const ticketTopicKey = (ref: string) => `mesa/${ref}`;
