// Tasks go straight to an agent. Handing a card to Claude ("Dárselo a Claude", "+ Tarea"
// without "Solo anotar", Nuevo pedido, `mesa task create|dispatch`) creates a linked
// andres_asks ticket owned by the lead session and wakes it with ticket.created
// { ref, ticketRef, taskId, kind? }. The lead triages by kind, claims the ticket and spawns
// its owner (docs/TEAM.md § 4). Handing 2+ new cards over at once ("Dárselas a Claude", Hoy
// "Abrir tarea y pasar a Claude") opens the same tickets but wakes the lead ONCE with
// ticket.batch { batchId, origin, tickets } instead of N ticket.created (docs/TEAM.md § 4, Batches).
//
// Safety: sample tasks never dispatch, and dispatching only writes to Mesa (a ticket and a
// wake); nothing leaves for Slack, Basecamp or GitHub.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { newId, TransitionError } from "../db/util";
import { inferKind } from "../domain/dispatch-kind";
import type { DispatchKind, Item, Task, TicketDetail } from "../domain/types";
import { emitWake } from "../wake/wake";
import { touchInteraction } from "./interaction";
import { itemsRepo } from "./items";
import { tasksRepo, type TaskInput } from "./tasks";
import { ticketsRepo, type RefInput, type TicketInput } from "./tickets";

/** The stable session that owns every ticket (same default as repo/index.ts leadSession). */
const lead = () => process.env.MESA_LEAD_SESSION ?? "lead";

export const SAMPLE_REFUSED = "sample tasks never dispatch";

export { inferKind };

export interface DispatchResult {
  task: Task;
  ticket: { id: string; ref: string };
  /** False when the card already had an open ticket: no new ticket, no second wake. */
  created: boolean;
}

/** Where a batch came from, carried on the ticket.batch wake. "github" and "slack": Mesa's own PR intake (repo/intake.ts). */
export type BatchOrigin = "hoy" | "tablero" | "cli" | "github" | "slack";

export interface BatchDispatchResult {
  /** The ticket.batch id ("bt_..."); null when no batch wake was sent (fewer than 2 new tickets). */
  batchId: string | null;
  results: DispatchResult[];
  /** Cards (or Hoy items) that were not dispatched (sample data). */
  skipped: { id: string; reason: "sample" }[];
}

/** One ticket of a ticket.batch wake. Existing and sample cards are never listed. */
export interface BatchTicket {
  ticketRef: string;
  taskId: string;
  title: string;
  kind?: DispatchKind;
  urls: string[];
}

type Linked = Pick<Item, "id" | "source" | "title" | "url" | "project">;

function ticketBody(t: Task, items: Linked[]): string {
  // Short on purpose (Andrés, t3: "en los tickets de pr hay como mucho ruido"): the excerpt and the bare links.
  // The title already names the item and the ticket carries taskId, so neither is repeated here.
  const links = [...new Set(items.map((i) => i.url).filter((u): u is string => Boolean(u)))];
  return [t.excerpt.trim(), links.join("\n")].filter(Boolean).join("\n\n");
}

export function dispatchRepo(db: Db) {
  const tasks = tasksRepo(db);
  const tickets = ticketsRepo(db);
  const items = itemsRepo(db);

  const openTicket = (t: Task) => {
    if (!t.ticketId) return null;
    const row = db.prepare("SELECT id, ref, status FROM tickets WHERE id = ?").get(t.ticketId) as { id: string; ref: string; status: string } | undefined;
    return row && row.status !== "closed" ? row : null;
  };

  /**
   * Hand one card to Claude. Idempotent: a card with an open ticket returns it unchanged. `quiet` skips the
   * ticket.created wake (the caller sends one ticket.batch for the whole call); `made` is what that wake lists.
   */
  const dispatchOne = (
    taskId: string,
    o: { kind?: DispatchKind; title?: string } = {},
    now = new Date(),
    quiet = false,
  ): { result: DispatchResult; made?: BatchTicket } => {
    const t = tasks.get(taskId);
    if (t.isSample) throw new TransitionError(SAMPLE_REFUSED);
    const existing = openTicket(t);
    if (existing) return { result: { task: t, ticket: { id: existing.id, ref: existing.ref }, created: false } };
    const linked = t.items ?? [];
    const refs: RefInput[] = linked.filter((i) => i.url).map((i) => ({ refType: "url", target: i.url!, label: i.title }));
    const kind = o.kind ?? inferKind(linked);
    const d = tickets.create(
      {
        direction: "andres_asks",
        title: o.title ?? t.title,
        body: ticketBody(t, linked),
        project: t.project || linked[0]?.project || undefined,
        ownerSession: lead(),
        itemId: linked[0]?.id,
        taskId: t.id,
        kind,
        quiet,
        refs,
      },
      now,
    );
    // The card now waits on Claude; its owner chip replaces the "Espera a Claude" tag.
    db.prepare("UPDATE tasks SET ticket_id = ?, wait_on = 'claude' WHERE id = ?").run(d.id, t.id);
    const made: BatchTicket = { ticketRef: d.ref, taskId: t.id, title: o.title ?? t.title, urls: linked.filter((i) => i.url).map((i) => i.url!) };
    if (kind) made.kind = kind;
    return { result: { task: tasks.get(t.id), ticket: { id: d.id, ref: d.ref }, created: true }, made };
  };

  /**
   * "Dárselas a Claude" over cards, inside the caller's transaction. Sample cards are skipped, not refused; an
   * unknown id throws NotFoundError. With 2+ NEW tickets they open exactly as one by one but the lead is woken once
   * with ticket.batch; exactly one new ticket wakes with the usual ticket.created; none, nothing.
   */
  const dispatchCards = (
    ids: string[],
    o: { kind?: DispatchKind; origin?: BatchOrigin; titles?: ReadonlyMap<string, string> },
    now: Date,
    skipped: BatchDispatchResult["skipped"] = [],
  ): BatchDispatchResult => {
    const live: Task[] = [];
    for (const id of [...new Set(ids)]) {
      const t = tasks.get(id);
      if (t.isSample) skipped.push({ id, reason: "sample" });
      else live.push(t);
    }
    const quiet = live.filter((t) => !openTicket(t)).length >= 2;
    const results: DispatchResult[] = [];
    const made: BatchTicket[] = [];
    for (const t of live) {
      const r = dispatchOne(t.id, { kind: o.kind, title: o.titles?.get(t.id) }, now, quiet);
      results.push(r.result);
      if (r.made) made.push(r.made);
    }
    let batchId: string | null = null;
    if (quiet) {
      batchId = newId("bt");
      const first = results.find((r) => r.created)!.ticket.id;
      emitWake(db, { sessionId: lead(), kind: "ticket.batch", entityType: "ticket", entityId: first, payload: { batchId, origin: o.origin ?? "cli", tickets: made } }, now);
    }
    return { batchId, results, skipped };
  };

  return {
    dispatch(taskId: string, o: { kind?: DispatchKind } = {}, now = new Date()): DispatchResult {
      return tx(db, () => {
        const r = dispatchOne(taskId, o, now).result;
        touchInteraction(db, now);
        return r;
      });
    },

    /** "Dárselas a Claude": one transaction; sample cards are skipped, not refused; 2+ new tickets wake the lead once. */
    dispatchMany(ids: string[], o: { kind?: DispatchKind; origin?: BatchOrigin } = {}, now = new Date()): BatchDispatchResult {
      return tx(db, () => {
        const out = dispatchCards(ids, o, now);
        touchInteraction(db, now);
        return out;
      });
    },

    /**
     * Hoy "Abrir tarea y pasar a Claude": every item gets its card (the one it already has, else a new one made the
     * way "Crear tarea" does) and the cards are dispatched as one batch (origin "hoy"), all in one transaction.
     * Sample items are skipped and get no card. An unknown item id throws NotFoundError and rolls everything back.
     */
    dispatchItems(itemIds: string[], o: { kind?: DispatchKind } = {}, now = new Date()): BatchDispatchResult {
      return tx(db, () => {
        const skipped: BatchDispatchResult["skipped"] = [];
        const cards: string[] = [];
        for (const id of [...new Set(itemIds)]) {
          const item = items.get(id);
          if (item.isSample) {
            skipped.push({ id: item.id, reason: "sample" });
            continue;
          }
          const card =
            item.taskId ??
            tasks.create({ title: item.title, source: item.source, project: item.project, excerpt: item.excerpt, station: item.station, itemIds: [item.id] }, now).id;
          cards.push(card);
        }
        const out = dispatchCards(cards, { ...o, origin: "hoy" }, now, skipped);
        touchInteraction(db, now);
        return out;
      });
    },

    /**
     * Mesa's own intake (repo/intake.ts): hand cards to Claude inside the caller's transaction, each ticket titled
     * as `titles` says (falls back to the card's title). Same wakes as "Dárselas a Claude": one new ticket is a
     * ticket.created, 2+ are ONE ticket.batch with this origin. Not an Andrés interaction (no touchInteraction).
     */
    dispatchAuto(ids: string[], o: { kind?: DispatchKind; origin: BatchOrigin; titles?: ReadonlyMap<string, string> }, now = new Date()): BatchDispatchResult {
      return tx(db, () => dispatchCards(ids, o, now));
    },

    /**
     * Create a card. Unless noteOnly, it is handed to Claude in the same transaction. Cards made
     * from ingested items (itemIds) and sample cards are only noted: they never auto-dispatch.
     */
    createTask(input: TaskInput & { noteOnly?: boolean; kind?: DispatchKind }, now = new Date()): { task: Task; ticket: DispatchResult["ticket"] | null } {
      const { noteOnly, kind, ...rest } = input;
      return tx(db, () => {
        const task = tasks.create(rest, now);
        const auto = !noteOnly && !rest.isSample && !(rest.itemIds?.length);
        if (!auto) return { task, ticket: null };
        const r = dispatchOne(task.id, { kind }, now).result;
        return { task: r.task, ticket: r.ticket };
      });
    },

    /**
     * Nuevo pedido: an andres_asks ticket that also gets its card on the Claude lane, linked both
     * ways, in one transaction. Other tickets (claude_asks, samples) are created as before.
     */
    createRequest(input: TicketInput, now = new Date()): TicketDetail {
      if (input.direction !== "andres_asks" || input.isSample) return tickets.create(input, now);
      return tx(db, () => {
        const first = (input.body ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
        const task = tasks.create(
          {
            title: input.title,
            source: "claude",
            excerpt: first.find((l) => l !== input.title.trim()) ?? "",
            project: input.project,
          },
          now,
        );
        const d = tickets.create({ ...input, ownerSession: input.ownerSession ?? lead(), taskId: task.id }, now);
        db.prepare("UPDATE tasks SET ticket_id = ?, wait_on = 'claude' WHERE id = ?").run(d.id, task.id);
        return d;
      });
    },
  };
}
