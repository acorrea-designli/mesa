// Request schemas for the REST API. The response types live in domain/types.ts.
import { z } from "zod";
import { SOURCES, STATIONS } from "../domain/types";
import { checklistProblem, MAX_STEP_NOTE, MAX_STEPS } from "../domain/ticket-checklists";
import { cardProblem, MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS } from "../domain/ticket-questions";

export const source = z.enum(SOURCES);
export const station = z.enum(STATIONS);
const waitOn = z.string().regex(/^(you|client|claude|none|person:.+)$/);
/** owner/name */
const REPO = /^[\w.-]+\/[\w.-]+$/;
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "expected an ISO date");

export const itemInput = z.object({
  source,
  externalId: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string().optional(),
  project: z.string().optional(),
  url: z.string().url().nullable().optional(),
  need: z.string().optional(),
  station: station.optional(),
  waitOn: waitOn.optional(),
  tag: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  isSample: z.boolean().optional(),
  receivedAt: isoDate.optional(),
});
export const itemPatch = itemInput.omit({ source: true, externalId: true }).partial();
/** POST /api/items/:id/unskip: the station and waitOn the item had before "Saltar". */
export const itemUnskip = z.object({ station, waitOn });

export const taskInput = z.object({
  title: z.string().min(1),
  source,
  excerpt: z.string().optional(),
  project: z.string().optional(),
  station: station.optional(),
  waitOn: waitOn.optional(),
  position: z.number().optional(),
  isSample: z.boolean().optional(),
  itemIds: z.array(z.string()).optional(),
  /** "Solo anotar (sin agente)": create the card only. Cards from ingested items never auto-dispatch. */
  noteOnly: z.boolean().optional(),
  kind: z.enum(["review", "request", "investigation", "reply"]).optional(),
});
export const taskPatch = z.object({
  title: z.string().min(1).optional(),
  excerpt: z.string().optional(),
  project: z.string().optional(),
  source: source.optional(),
  waitOn: waitOn.optional(),
  position: z.number().optional(),
});
export const taskMove = z.object({ station, position: z.number().optional() });
export const taskSync = z.object({
  syncState: z.enum(["synced", "pending", "error", "local"]),
  ghItemId: z.string().nullable().optional(),
  ghContentUrl: z.string().nullable().optional(),
  syncError: z.string().nullable().optional(),
});
export const taskDispatch = z.object({ kind: z.enum(["review", "request", "investigation", "reply"]).optional() });
const taskIds = z.array(z.string().min(1)).min(1).max(200);
export const taskBatch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), ids: taskIds, station }),
  z.object({ action: z.literal("dispatch"), ids: taskIds, kind: z.enum(["review", "request", "investigation", "reply"]).optional() }),
  /** Hoy "Abrir tarea y pasar a Claude": each item's card (made when it has none), dispatched as one batch. */
  z.object({ action: z.literal("dispatch_items"), itemIds: taskIds, kind: z.enum(["review", "request", "investigation", "reply"]).optional() }),
  /** Deshacer of a batch move: each card back to its own previous station. */
  z.object({ action: z.literal("restore"), moves: z.array(z.object({ id: z.string().min(1), station })).min(1).max(200) }),
]);
export const taskLink = z.object({ itemIds: z.array(z.string()).min(1) });

const ticketOption = z.object({ key: z.string().min(1).max(3), label: z.string().min(1), detail: z.string().optional() });
/** One question of a card (t108): its text, 2-6 options with keys A-F, the recommended key and why. */
const questionInput = z.object({
  text: z.string().optional(),
  options: z.array(ticketOption).min(MIN_OPTIONS).max(MAX_OPTIONS),
  recommended: z.string().optional(),
  recommendation: z.string().optional(),
});
/** Andrés's answer to one open question: a pick, his own words, or both. */
const questionAnswer = z
  .object({ questionId: z.string().min(1), chosen: z.string().min(1).optional(), text: z.string().optional() })
  .refine((a) => Boolean(a.chosen || a.text?.trim()), "an answer needs chosen or text");

/** A card must be valid as a whole (cardProblem): unique keys A-F, the recommended key among them, text when 2+. */
const checkCard = (
  m: { questions?: z.infer<typeof questionInput>[]; options?: z.infer<typeof ticketOption>[]; recommended?: string; recommendation?: string },
  ctx: z.RefinementCtx,
) => {
  const card = m.questions?.length ? m.questions : m.options?.length ? [{ text: "", options: m.options, recommended: m.recommended }] : null;
  const problem = card ? cardProblem(card, { requireText: card.length > 1 }) : null;
  if (problem) ctx.addIssue({ code: "custom", message: problem, path: [m.questions?.length ? "questions" : "options"] });
};

const refInput = z.object({
  refType: z.enum(["ticket", "item", "url"]),
  target: z.string().min(1),
  label: z.string().optional(),
});

export const ticketInput = z.object({
  direction: z.enum(["claude_asks", "andres_asks"]),
  title: z.string().min(1),
  project: z.string().optional(),
  ownerSession: z.string().optional(),
  itemId: z.string().optional(),
  isSample: z.boolean().optional(),
  body: z.string().optional(),
  questions: z.array(questionInput).min(1).max(MAX_QUESTIONS).optional(),
  options: z.array(ticketOption).optional(),
  recommended: z.string().optional(),
  recommendation: z.string().optional(),
  refs: z.array(refInput).optional(),
}).superRefine(checkCard);

/** Claude: body, a card (`questions`, or one question as `options`), ask. Andrés: body, `answers` (or `chosen`). */
export const ticketMessage = z
  .object({
    author: z.enum(["andres", "claude"]),
    body: z.string().optional(),
    questions: z.array(questionInput).min(1).max(MAX_QUESTIONS).optional(),
    answers: z.array(questionAnswer).min(1).max(MAX_QUESTIONS * 10).optional(),
    options: z.array(ticketOption).optional(),
    recommended: z.string().optional(),
    recommendation: z.string().optional(),
    chosen: z.string().optional(),
    ask: z.boolean().optional(),
    refs: z.array(refInput).optional(),
    session: z.string().optional(),
  })
  .superRefine((m, ctx) => {
    if (m.author === "andres" && (m.questions?.length || m.options?.length)) ctx.addIssue({ code: "custom", message: "only Claude asks questions", path: ["questions"] });
    if (m.author === "claude" && (m.answers?.length || m.chosen)) ctx.addIssue({ code: "custom", message: "only Andrés answers questions", path: ["answers"] });
    checkCard(m, ctx);
  });

/** A checklist (t124): an optional body (the context) and 1-30 steps, each with text and an optional Markdown detail. */
export const ticketChecklist = z
  .object({
    body: z.string().optional(),
    steps: z.array(z.object({ text: z.string(), detail: z.string().nullish() })).min(1).max(MAX_STEPS),
    refs: z.array(refInput).optional(),
    session: z.string().optional(),
  })
  .superRefine((m, ctx) => {
    const problem = checklistProblem(m.steps);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["steps"] });
  });

/** One step set either way (PUT /api/tickets/:id/steps/:step). `note` is Claude's one-line proof; Andrés's calls carry none. */
export const stepSet = z.object({ done: z.boolean(), note: z.string().trim().max(MAX_STEP_NOTE).optional(), session: z.string().optional() });

/** Claude withdraws an open question (mesa ticket question withdraw <tq id> --why W). */
export const questionWithdraw = z.object({ reason: z.string().trim().min(1), session: z.string().optional() });

export const plannedAction = z.object({
  kind: z.string().min(1),
  source,
  label: z.string().min(1),
  mode: z.enum(["direct", "needs_ok"]),
  target: z.record(z.string(), z.unknown()).optional(),
});
export const ticketPlan = z.object({ actions: z.array(plannedAction), session: z.string().optional() });
/**
 * `only`: pre-approve just these planned needs_ok steps (a partial approval); `revoke`: take back the pre-approval of
 * these approved steps (back to planned); without either it is the whole plan, minus `reject`.
 */
export const ticketPlanApprove = z
  .object({ reject: z.array(z.string()).optional(), only: z.array(z.string()).min(1).optional(), revoke: z.array(z.string()).min(1).optional() })
  .refine((b) => !(b.only && b.reject?.length), { message: "only and reject cannot be combined" })
  .refine((b) => !(b.revoke && (b.only || b.reject?.length)), { message: "revoke cannot be combined with only or reject" });
/**
 * `pause` / `ongoing` (t126) need a reason; `untilTicket` (a ref or id) only goes with `pause`. `by` defaults to
 * Andrés (the UI), or to Claude on a CLI call (x-mesa-client: cli).
 */
export const ticketTransition = z
  .object({
    event: z.enum(["claim", "close", "reopen", "pause", "ongoing", "resume"]),
    by: z.enum(["andres", "claude"]).optional(),
    reason: z.string().optional(),
    session: z.string().optional(),
    untilTicket: z.string().trim().min(1).optional(),
  })
  .superRefine((b, ctx) => {
    if ((b.event === "pause" || b.event === "ongoing") && !b.reason?.trim()) ctx.addIssue({ code: "custom", path: ["reason"], message: "a pause needs a reason" });
    if (b.untilTicket && b.event !== "pause") ctx.addIssue({ code: "custom", path: ["untilTicket"], message: "only a paused ticket can wait for another ticket" });
  });
/** The lead groups same-topic tickets of a ticket.batch (mesa ticket fold <primary> <ref>... --why W). */
export const ticketFold = z.object({
  from: z.array(z.string().min(1)).min(1).max(50),
  why: z.string().trim().min(1),
  session: z.string().optional(),
});
/** Andrés splits a folded ticket out again (mesa ticket unfold <primary> <ref>). */
export const ticketUnfold = z.object({ ticket: z.string().min(1) });
/** What a session may report. "approved" is Andrés's (POST /api/tickets/:id/plan/approve), never a session's. */
export const actionState = z.object({
  state: z.enum(["running", "done", "failed"]),
});

const slackDest = z.object({
  kind: z.enum(["slack_thread", "slack_channel"]),
  workspace: z.string().min(1),
  channel: z.string().min(1),
  channelId: z.string().optional(),
  threadTs: z.string().optional(),
  threadLabel: z.string().optional(),
  postAs: z.string().min(1),
});
const basecampDest = z.object({
  kind: z.enum(["basecamp_comment", "basecamp_campfire", "basecamp_message"]),
  project: z.string().min(1),
  projectId: z.string().optional(),
  recordingId: z.string().optional(),
  recordingTitle: z.string().optional(),
  /** basecamp_comment only (refined on salidaInput): Basecamp person ids, with the name shown on the card. */
  mentions: z.array(z.object({ id: z.string().trim().min(1), name: z.string().trim().min(1) })).max(20).optional(),
  postAs: z.string().min(1),
});
const githubDest = z.object({
  kind: z.enum(["github_review", "github_comment"]),
  repo: z.string().regex(REPO),
  pr: z.number().int().positive(),
  event: z.enum(["APPROVE", "COMMENT", "REQUEST_CHANGES"]).optional(),
  path: z.string().optional(),
  line: z.number().int().positive().optional(),
  commitId: z.string().optional(),
  findingN: z.number().int().optional(),
  inReplyTo: z.string().optional(),
  comments: z
    .array(
      z.object({
        path: z.string().optional(),
        line: z.number().int().positive().optional(),
        body: z.string().min(1),
        findingN: z.number().int().optional(),
        inReplyTo: z.string().optional(),
      }),
    )
    .optional(),
  postAs: z.string().min(1),
});
/** A Google Calendar event (t112). The event's fields live in the version body (calendar-event.ts); this is where it goes. */
const calendarDest = z.object({
  kind: z.literal("calendar_event"),
  calendar: z.string().min(1),
  invitees: z.array(z.string().min(3)).max(50).optional(),
  meet: z.boolean().optional(),
  // Not validated here: the version body is the truth and checkBody gives the Spanish problem; syncCalendarDestination rewrites it.
  recurrence: z.string().max(300).optional(),
  postAs: z.string().min(1),
});
export const destination = z.union([slackDest, basecampDest, githubDest, calendarDest]);

export const salidaInput = z
  .object({
    source: z.enum(["slack", "basecamp", "github", "calendar"]),
    destination,
    body: z.string(),
    title: z.string().optional(),
    context: z.string().optional(),
    ticketId: z.string().optional(),
    links: z.array(z.object({ source, label: z.string(), url: z.string().optional() })).optional(),
    ownerSession: z.string().optional(),
    expiresAt: isoDate.optional(),
    isSample: z.boolean().optional(),
    draft: z.boolean().optional(),
  })
  .refine((s) => s.destination.kind.startsWith(s.source), "destination kind must match source")
  .refine(
    (s) => {
      const d = s.destination;
      return !("mentions" in d && d.mentions?.length) || d.kind === "basecamp_comment";
    },
    "mentions are only for a basecamp_comment: a Campfire line is plain text (nobody is pinged) and a message-board post has no mentions param; drop mentions or send a comment",
  )
  .refine(
    (s) =>
      s.body.trim().length > 0 ||
      (s.destination.kind === "github_review" && (s.destination.event === "APPROVE" || Boolean(s.destination.comments?.length))),
    "body is required (only a GitHub APPROVE or a batched review with comments may be empty)",
  );

export const salidaVersion = z.object({
  body: z.string().min(1),
  author: z.enum(["claude", "andres"]).default("claude"),
  turnId: z.string().optional(),
  chipLabel: z.string().max(40).optional(),
});

export const mark = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  kind: z.enum(["keep", "redo", "drop"]),
  text: z.string(),
});
export const salidaTurn = z.object({
  body: z.string().optional(),
  marks: z.array(mark).optional(),
  chipLabel: z.string().max(40).optional(),
});

/** Slack only (the machine refuses a mode on any other source): omitted = draft. */
const sendMode = z.enum(["draft", "send"]);

export const salidaTransition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("propose") }),
  z.object({ type: z.literal("approve"), version: z.number().int().min(1), mode: sendMode.optional() }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("sent"), permalink: z.string().optional(), simulated: z.boolean().optional() }),
  z.object({ type: z.literal("drafted"), simulated: z.boolean().optional() }),
  z.object({ type: z.literal("confirm_sent") }),
  z.object({ type: z.literal("failed"), error: z.string().min(1) }),
  z.object({ type: z.literal("retry") }),
  z.object({ type: z.literal("deny") }),
  z.object({ type: z.literal("withdraw"), reason: z.string().trim().min(1) }),
  z.object({ type: z.literal("schedule"), at: isoDate, version: z.number().int().min(1), mode: sendMode.optional() }),
  z.object({ type: z.literal("unschedule") }),
  z.object({ type: z.literal("request_delete") }),
  z.object({ type: z.literal("deleted") }),
  z.object({ type: z.literal("request_restore") }),
  z.object({ type: z.literal("restored") }),
  z.object({ type: z.literal("hold"), reason: z.string().min(1) }),
  z.object({ type: z.literal("unqueue") }),
  z.object({ type: z.literal("bounce"), reason: z.string().min(1) }),
]);

export const salidaSelect = z.object({ n: z.number().int().min(1) });
export const salidaStar = z.object({ starred: z.boolean() });
export const salidaEdit = z.object({ body: z.string().min(1) });

export const sessionInput = z.object({
  id: z.string().min(1).max(120),
  label: z.string().optional(),
  cwd: z.string().optional(),
  project: z.string().optional(),
});
export const waitAck = z.object({ session: z.string().min(1), cursor: z.number().int().min(0) });

export const engramLink = z.object({
  entityType: z.enum(["ticket", "salida", "task"]),
  entityId: z.string().min(1),
  project: z.string().min(1),
  topicKey: z.string().optional(),
  observationId: z.string().optional(),
});

// ---------- ephemeral agents ----------
export const briefInput = z.object({
  body: z.string().optional(),
  goal: z.string().optional(),
  decisions: z.array(z.string()).optional(),
  planStep: z.string().optional(),
  openQuestions: z.array(z.string()).optional(),
  nextAction: z.string().optional(),
  updatedBy: z.string().optional(),
});

export const handoffInput = z.object({
  agent: z.string().min(1),
  role: z.string().optional(),
  status: z.enum(["done", "paused", "blocked"]),
  body: z.string().optional(),
  done: z.string().optional(),
  remaining: z.string().optional(),
  artifacts: z.record(z.string(), z.unknown()).optional(),
});

/** <role>-<ticketRef>[-k], lowercase. */
export const agentName = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/, "agent names look like <role>-<ticketRef>[-k]");
export const teamInput = z.object({
  ticketRef: z.string().min(1),
  agent: agentName,
  role: z.string().min(1),
  owner: z.boolean().optional(),
});

// ---------- approvals ----------
export const approvalInput = z.object({
  ticketRef: z.string().nullable().optional(),
  agent: z.string().min(1),
  tool: z.string().min(1),
  summary: z.string().min(1).max(500),
  detail: z.string().max(400_000).optional(),
  cwd: z.string().optional(),
  hints: z.array(z.string()).max(10).optional(),
  expiresAt: isoDate.optional(),
  // t128 part H: a card for a call auto mode already denied. There is no `rule` field on purpose: the server derives it.
  kind: z.enum(["permission", "denied"]).optional(),
  reason: z.string().max(2000).optional(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
  /** The denied session (hook input session_id): the one-shot grant is bound to it. */
  sessionId: z.string().max(200).optional(),
});

/** POST /api/approvals/grants/consume, from the PreToolUse hook: the call it is about to let through. */
export const grantConsumeInput = z.object({
  tool: z.string().min(1),
  toolInput: z.record(z.string(), z.unknown()),
  caller: z.string().min(1).max(200),
  sessionId: z.string().max(200).optional(),
});

// ---------- reviews ----------
export const findingInput = z.object({
  repo: z.string().regex(REPO),
  pr: z.number().int().positive(),
  n: z.number().int().positive().optional(),
  // label and summary are required for a new finding (the repo checks, 400); an update may omit any field
  label: z.enum(["blocker", "nit", "comment"]).optional(),
  at: z.string().optional(),
  anchor: z.string().optional(),
  summary: z.string().min(1).optional(),
  explanation: z.string().optional(),
  state: z.enum(["open", "fixed", "waived", "dismissed"]).optional(),
  sha: z.string().optional(),
  ghCommentId: z.union([z.string(), z.number().int()]).transform(String).nullable().optional(),
});
export const reviewOpenInput = z.object({
  repo: z.string().regex(REPO),
  pr: z.number().int().positive(),
  sha: z.string().trim().min(1),
});
export const reviewCloseInput = z.object({ reason: z.string().trim().min(1) });
export const reviewActionInput = z.object({
  action: z.enum(["approve", "approve_anyway", "post", "dismiss", "explain"]),
  findingNs: z.array(z.number().int().positive()).optional(),
  note: z.string().optional(),
});

// ---------- sources and sweep ----------
export const healthSource = z.enum(["github", "github_project", "slack", "basecamp", "engram", "calendar"]);
const isoOrNull = isoDate.nullable();
export const sourcePatch = z.object({
  health: z.enum(["ok", "degraded", "down"]).optional(),
  note: z.string().max(500).optional(),
  watermark: z.string().max(500).nullable().optional(),
  lastChecked: isoOrNull.optional(),
  lastNewAt: isoOrNull.optional(),
  backoffUntil: isoOrNull.optional(),
  cadenceS: z.number().int().min(5).max(86_400).optional(),
  errorCount: z.number().int().min(0).optional(),
  lastError: z.string().max(2000).nullable().optional(),
});
export const sweepInput = z.object({ sources: z.array(z.enum(["slack", "basecamp", "github"])).optional() });

/** POST /api/ignored-projects. project is the project key (domain/ignore.ts projectKey). */
export const ignoreInput = z.object({
  source: z.enum(["github", "slack", "basecamp", "claude", "*"]),
  project: z.string().trim().min(1),
  label: z.string().trim().optional(),
});

export const sandboxPushInput = z.object({
  ref: z.string().trim().min(1),
  sha: z.string().trim().min(1).optional(),
});

/** GET /api/semana and /semana: any day of the week (YYYY-MM-DD, normalized to its Monday), one project by its shown name. */
export const weekQuery = z.object({
  semana: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD").optional(),
  proyecto: z.string().trim().min(1).max(120).optional(),
  /** One day of the week (YYYY-MM-DD) to narrow the page to; a day outside the week is ignored. */
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD").optional(),
});

const rateWindow = z.object({
  /** Percent used, as Claude Code reports it. */
  usedPercentage: z.number().min(0).max(1000),
  /** Epoch seconds. */
  resetsAt: z.number().int().min(0),
});
/** POST /api/usage: what scripts/statusline.mjs saves each time Claude Code refreshes its status line. */
export const usageInput = z.object({
  sessionId: z.string().max(200).default(""),
  model: z.object({ id: z.string().max(200).default(""), displayName: z.string().max(200).default("") }).default({ id: "", displayName: "" }),
  capturedAt: isoDate.optional(),
  fiveHour: rateWindow.nullable().optional(),
  sevenDay: rateWindow.nullable().optional(),
});
