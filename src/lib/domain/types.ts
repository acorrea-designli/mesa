// Shared domain types. These are the shapes the API returns and the UI renders.
// Keep them free of server-only imports so client components can use them.

export const SOURCES = ["github", "slack", "basecamp", "claude"] as const;
export type Source = (typeof SOURCES)[number];

/**
 * A source line colour: the four item sources plus Calendario, the fifth. Calendar events are not items (no station,
 * no band tick); the extra line colour is used on the Calendario screen, the Próxima reunión strip, its source-health
 * row and the calendar salida chips.
 */
export type LineSource = Source | "calendar";

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
  /** Set when Andrés skipped the item ("Saltar"): done, waitOn none, and no upsert reopens it. */
  skippedAt: string | null;
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
  items?: Pick<Item, "id" | "source" | "title" | "url" | "project" | "meta">[];
  /** Who works the linked ticket (the owner chip). Filled by the repository; null without a ticket. */
  owner?: TaskOwner | null;
}

/** The linked ticket of a card and its owner agent (ticket_team, owner = 1, live). */
export interface TaskOwner {
  ticketId: string;
  ticketRef: string;
  ticketStatus: TicketStatus;
  /** Ref of the ticket a paused ticket waits for ("t125"), for the chip "En pausa · hasta t125". */
  pausedUntil?: string | null;
  /** Live owner agent ("tl-t21"); null until the lead claims the ticket and spawns one. */
  agent: string | null;
  role: string | null;
}

/** What a ticket.created wake hints to the lead for triage (docs/TEAM.md § 4). */
export type DispatchKind = "review" | "request" | "investigation" | "reply";
export const DISPATCH_KINDS: readonly DispatchKind[] = ["review", "request", "investigation", "reply"];

// ---------- tickets ----------

export type TicketDirection = "claude_asks" | "andres_asks";
export type TicketStatus = "waiting_andres" | "waiting_claude" | "working" | "closed" | "paused" | "ongoing";
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

export type QuestionState = "open" | "answered" | "withdrawn";

/**
 * One question of a question card (t108): a Claude message carries 1-6 of them, each with 2-6 options (keys A-F).
 * The state is explicit: open until Andrés answers it (a pick or his own words) or Claude withdraws it.
 */
export interface TicketQuestion {
  id: string; // tq_*
  ticketId: string;
  /** The Claude message that asked it (the card). */
  messageId: string;
  /** Step in its card, from 1. */
  n: number;
  /** The question; '' on a 1-step card whose message body is the question. */
  text: string;
  options: TicketOption[];
  recommended: string | null;
  recommendation: string | null;
  state: QuestionState;
  /** The key he picked; null when he answered in his own words or has not answered. */
  chosen: string | null;
  /** His own words ("Otra respuesta"). */
  answerText: string | null;
  /** The Andrés message that answered it. */
  answerMessageId: string | null;
  answeredAt: string | null;
  withdrawReason: string | null;
  createdAt: string;
}

/** One answer inside an Andrés message: a pick, his own words, or both. */
export interface QuestionAnswer {
  questionId: string;
  chosen?: string;
  text?: string;
}

export type StepState = "open" | "done";
export type StepBy = "andres" | "claude";

/**
 * One step of a checklist (t124): a Claude message carries 1-30 of them. Anyone sets a step either way, any number of
 * times: Andrés from the board and the phone, Claude from the CLI when it verified the step itself (`note`).
 */
export interface TicketStep {
  id: string; // ck_*
  ticketId: string;
  /** The Claude message that posted the checklist. */
  messageId: string;
  /** Step in its checklist, from 1. */
  n: number;
  text: string;
  /** Optional Markdown. */
  detail: string | null;
  state: StepState;
  /** Who set it done; null while open. */
  doneBy: StepBy | null;
  doneAt: string | null;
  /** Claude's one-line verification, null when Andrés ticked it. */
  note: string | null;
  createdAt: string;
}

/** The steps of one message, with their counts. */
export interface Checklist {
  messageId: string;
  done: number;
  total: number;
  allDone: boolean;
  steps: TicketStep[];
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
  /** Why the ticket is paused ("En pausa") or ongoing ("En proceso"); null in every other status (t126). */
  pauseReason: string | null;
  /** The ticket a paused ticket waits for, as a ref ("t125"); it resumes when that one closes. Null if none. */
  pausedUntil: string | null;
  pausedUntilTicketId: string | null;
  /** When the ticket entered paused/ongoing. */
  pausedAt: string | null;
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
  /** Every question card row of the ticket, in card order then step order. */
  questions: TicketQuestion[];
  /** Every checklist of the ticket (t124), oldest first, with its steps and done / total. */
  checklists: Checklist[];
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
  | "draft_created" // Slack, mode draft: the text waits as a draft in Andrés's Slack ("Borrador en Slack · envíalo tú") until "Ya lo envié"
  | "deleted"
  | "withdrawn"; // the lead took a stale pending/draft salida back (t123): final, never sent, the reason stays visible

export type SalidaSource = "slack" | "basecamp" | "github" | "calendar";

/**
 * How a Slack salida goes out, chosen by Andrés with his approval click: "draft" (default) leaves the text as a draft in
 * his Slack that he sends himself (it goes out as his own message); "send" has Claude send it through the connector,
 * which adds "Sent using @Claude". Non-Slack salidas have none (null).
 */
export type SalidaSendMode = "draft" | "send";

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
      /**
       * basecamp_comment only: the people the comment pings (Basecamp person ids from list_project_people, as
       * strings). The lead passes the ids to create_comment as `mentions`; a typed "@Name" notifies nobody.
       * Campfire lines and message-board posts cannot mention through the MCP, so they never carry this.
       */
      mentions?: BasecampMention[];
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
    }
  | {
      /**
       * A Google Calendar event created by the lead through the Google Calendar connector (t112). The event's exact
       * fields are the approved version's body (src/lib/domain/calendar-event.ts: título, inicio, fin, zona,
       * invitados, Meet, descripción), so editing the text edits the event; the destination names only where it goes.
       */
      kind: "calendar_event";
      calendar: string; // "primary" or a calendar id/name, shown as the chip "Tu calendario principal"
      /** Invitee addresses at proposal time, for the chips; the body is the truth the guard compares. */
      invitees?: string[];
      meet?: boolean;
      postAs: string;
    };

export interface BasecampMention {
  id: string;
  name: string;
}

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
  calendar_event: "none", // the connector has no delete tool wired here; Andrés removes it in Google Calendar
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
  /** Slack only: set with the approval (or Programar), cleared by an undo; null for every other source. */
  sendMode: SalidaSendMode | null;
  undoUntil: string | null;
  releasedAt: string | null;
  sendAt: string | null;
  expiresAt: string | null;
  /** When the Slack draft was created (draft_created). */
  draftedAt: string | null;
  sentAt: string | null;
  permalink: string | null;
  error: string | null;
  deleteRequestedAt: string | null;
  deletedAt: string | null;
  /** Why the lead withdrew it (status withdrawn), and when. Null otherwise. */
  withdrawReason: string | null;
  withdrawnAt: string | null;
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
  /** "Abrir conversación" on a Slack salida: the Slack-app deep link (needs MESA_SLACK_TEAM_ID) and the https fallback (needs MESA_SLACK_DOMAIN). Set by the read model and the salida API. */
  conversation?: ConversationLinks | null;
}

export interface ConversationLinks {
  app: string | null;
  web: string | null;
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
  | "ticket.created" // Andrés opened a request or handed a card to Claude: { ref, ticketRef, taskId, kind? } (a split ticket also carries splitFrom)
  | "ticket.batch" // Andrés handed 2+ cards to Claude at once: { batchId, origin, tickets: [{ ticketRef, taskId, title, kind?, urls }] }; replaces the N ticket.created
  | "ticket.answered" // Andrés replied or chose an option
  | "ticket.plan_approved"
  | "ticket.checklist" // Andrés ticked or unticked a checklist step (never Claude's own mark): { ref, ticketRef, messageId, stepId, n, done, doneCount, total, allDone }
  | "ticket.closed"
  | "ticket.reopened"
  | "ticket.resumed" // a paused/ongoing ticket came back to Claude: { ref, ticketRef, by: "andres"|"dependency", dependencyRef? }; the lead respawns the owner
  | "ticket.permission_requested" // "Pídeme permiso": { ref, ticketRef, messageId }; the agent files the approval card (docs/TEAM.md section 6)
  | "ticket.annotations" // Andrés sent PDF marks to Claude ("Enviar a Claude (n)"): { ref, ticketRef, attachmentId, annotationIds, count }; read them with mesa ticket annotations, answer with mesa ticket annotation-reply
  | "ticket.pr_message" // a Slack message about the ticket's PR (repo/intake.ts): { ref, ticketRef, messageId, itemId, repo, pr, who, url, channelId, ts, threadTs }; the lead spawns or reuses writer-<ref>, who records a notice (mesa item pr-notice) or answers with a salida
  | "salida.turn" // Andrés asked for a change
  | "salida.released" // undo window over: send now. payload { version, status, mode, recheckThread }; mode (Slack only) "draft" = leave a Slack draft, "send" = send through the connector
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
  /** Everything done today as /semana counts it (tickets closed, messages sent, reviews approved, cards done). */
  doneToday: number;
  /** Items in station done since midnight: Hoy's own "Hecho hoy" figure. */
  itemsDoneToday: number;
  /** Calendario: meetings left today (not over, not declined, not all-day); 0 on a board without the feed. */
  calendar: number;
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
  state: "open" | "approving" | "approved" | "closed";
  salidaId: string | null;
  /** Why the lead closed the card (state closed), and when. Empty / null otherwise. */
  closeReason: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  findings: Finding[];
}

export type ReviewAction = "approve" | "approve_anyway" | "post" | "dismiss" | "explain";

// ---------- sources: sweep state and health ----------

export type HealthSource = "github" | "github_project" | "slack" | "basecamp" | "engram" | "calendar";
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
  /** The brief's open questions plus every open card question. */
  openQuestions: string[];
  /** Every card question of the ticket with its state (open, answered, withdrawn). */
  questions: TicketQuestion[];
  /** Every checklist of the ticket with its steps (state, doneBy, note) and done / total (t124). */
  checklists: Checklist[];
  team: TeamAgent[];
  handoffs: Handoff[]; // latest per agent, newest first
  latestHandoff: Handoff | null;
  approvals: Approval[]; // pending
  salidas: Pick<Salida, "id" | "status" | "source" | "title" | "currentVersion">[]; // not final
  findings: Finding[];
  /** The PR reviews of this ticket, without findings (see `findings`): headSha = reviewed head, seenHead = newest head seen after a push. */
  reviews: Omit<Review, "findings">[];
  engram: { topicKey: string; project: string; links: EngramLink[] };
  /** PDF review marks per attachment (only PDFs that have any); read them with `mesa ticket annotations`. */
  annotations: AnnotationSummary[];
}

/** Engram topic key for a ticket: every ticket thread is saved under it. */
export const ticketTopicKey = (ref: string) => `mesa/${ref}`;

// ---------- Calendario (t112) ----------

export type CalendarResponse = "accepted" | "declined" | "tentative" | "needs_action" | "none";

export interface CalendarAttendee {
  email: string;
  name: string | null;
  response: CalendarResponse;
}

/** One occurrence of a meeting, read from Andrés's private iCal feed (read only). Times are UTC ISO strings. */
export interface CalendarEvent {
  id: string;
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** All-day: drawn from the Bogota midnight of its first day to the Bogota midnight after its last; never reminded. */
  allDay: boolean;
  timeZone: string | null;
  location: string | null;
  meetUrl: string | null;
  attendees: CalendarAttendee[];
  attendeesCount: number;
  organizer: string | null;
  /** Andrés's own answer (PARTSTAT); `none` when the feed does not say. */
  response: CalendarResponse;
  status: "confirmed" | "tentative";
  recurring: boolean;
  isSample: boolean;
  fetchedAt: string;
}

/** GET /api/calendar: the window's events plus the connection and health the screen shows. */
export interface CalendarPayload {
  now: string;
  /** MESA_GCAL_ICS_URL is set. The address itself never leaves the server. */
  configured: boolean;
  sandbox: boolean;
  health: SourceState["health"] | "none";
  note: string;
  lastRefresh: string | null;
  lastError: string | null;
  events: CalendarEvent[];
  /** The next meeting (or the one in progress) as the "Próxima reunión" strip shows it. */
  next: CalendarEvent | null;
}

// ---------- PDF review (t125) ----------

export type AnnotationKind = "highlight" | "note" | "rect" | "ellipse" | "arrow";
export type AnnotationState = "open" | "resolved";

/** Page units: the page's viewport at scale 1 (PDF points), origin top left, y down. Scale independent. */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type AnnotationGeometry =
  | { rects: PageRect[] } // highlight
  | { x: number; y: number } // note
  | PageRect // rect, ellipse
  | { x1: number; y1: number; x2: number; y2: number }; // arrow

export interface AnnotationReply {
  id: string;
  annotationId: string;
  author: Author;
  body: string;
  createdAt: string;
}

export interface Annotation {
  id: string;
  ticketId: string;
  attachmentId: string;
  page: number;
  kind: AnnotationKind;
  geometry: AnnotationGeometry;
  /** Bounding box of the geometry in page units (a note is a zero-size box at its point). */
  rect: PageRect;
  quote: string;
  body: string;
  author: Author;
  state: AnnotationState;
  /** When it went to Claude in a ticket.annotations wake; null = not sent yet. */
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  replies: AnnotationReply[];
}

/** TicketContext.annotations: what Claude has to look at, per PDF. */
export interface AnnotationSummary {
  attachmentId: string;
  filename: string;
  open: number;
  total: number;
}
