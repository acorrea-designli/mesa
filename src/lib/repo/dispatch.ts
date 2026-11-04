// Tasks go straight to an agent. Handing a card to Claude ("Dárselo a Claude", "+ Tarea"
// without "Solo anotar", Nuevo pedido, `mesa task create|dispatch`) creates a linked
// andres_asks ticket owned by the lead session and wakes it with ticket.created
// { ref, ticketRef, taskId, kind? }. The lead triages by kind, claims the ticket and spawns
// its owner (docs/TEAM.md § 4).
//
// Safety: sample tasks never dispatch, and dispatching only writes to Mesa (a ticket and a
// wake); nothing leaves for Slack, Basecamp or GitHub.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { TransitionError } from "../db/util";
import type { DispatchKind, Item, Task, TicketDetail } from "../domain/types";
import { touchInteraction } from "./interaction";
import { tasksRepo, type TaskInput } from "./tasks";
import { ticketsRepo, type RefInput, type TicketInput } from "./tickets";

/** The stable session that owns every ticket (same default as repo/index.ts leadSession). */
const lead = () => process.env.MESA_LEAD_SESSION ?? "lead";

export const SAMPLE_REFUSED = "sample tasks never dispatch";

export interface DispatchResult {
  task: Task;
  ticket: { id: string; ref: string };
  /** False when the card already had an open ticket: no new ticket, no second wake. */
  created: boolean;
}

export interface BatchDispatchResult {
  results: DispatchResult[];
  /** Cards that were not dispatched (sample data). */
  skipped: { id: string; reason: "sample" }[];
}

type Linked = Pick<Item, "id" | "source" | "title" | "url" | "project">;

/** A triage hint from the card's linked items: a GitHub PR is a review; otherwise the lead decides. */
export function inferKind(items: Pick<Item, "source" | "url">[]): DispatchKind | undefined {
  return items.some((i) => i.source === "github" && /\/pull\/\d+/.test(i.url ?? "")) ? "review" : undefined;
}

function ticketBody(t: Task, items: Linked[]): string {
  const lines = [t.excerpt.trim()];
  const links = items.filter((i) => i.url).map((i) => `- ${i.title}: ${i.url}`);
  if (links.length) lines.push(`Enlaces:\n${links.join("\n")}`);
  lines.push(`Tarjeta del tablero: ${t.id}`);
  return lines.filter(Boolean).join("\n\n");
}

export function dispatchRepo(db: Db) {
  const tasks = tasksRepo(db);
  const tickets = ticketsRepo(db);

  const openTicket = (t: Task) => {
    if (!t.ticketId) return null;
    const row = db.prepare("SELECT id, ref, status FROM tickets WHERE id = ?").get(t.ticketId) as { id: string; ref: string; status: string } | undefined;
    return row && row.status !== "closed" ? row : null;
  };

  /** Hand one card to Claude. Idempotent: a card with an open ticket returns it unchanged. */
  const dispatchOne = (taskId: string, o: { kind?: DispatchKind } = {}, now = new Date()): DispatchResult => {
    const t = tasks.get(taskId);
    if (t.isSample) throw new TransitionError(SAMPLE_REFUSED);
    const existing = openTicket(t);
    if (existing) return { task: t, ticket: { id: existing.id, ref: existing.ref }, created: false };
    const items = t.items ?? [];
    const refs: RefInput[] = items.filter((i) => i.url).map((i) => ({ refType: "url", target: i.url!, label: i.title }));
    const d = tickets.create(
      {
        direction: "andres_asks",
        title: t.title,
        body: ticketBody(t, items),
        project: t.project || items[0]?.project || undefined,
        ownerSession: lead(),
        itemId: items[0]?.id,
        taskId: t.id,
        kind: o.kind ?? inferKind(items),
        refs,
      },
      now,
    );
    // The card now waits on Claude; its owner chip replaces the "Espera a Claude" tag.
    db.prepare("UPDATE tasks SET ticket_id = ?, wait_on = 'claude' WHERE id = ?").run(d.id, t.id);
    return { task: tasks.get(t.id), ticket: { id: d.id, ref: d.ref }, created: true };
  };

  return {
    dispatch(taskId: string, o: { kind?: DispatchKind } = {}, now = new Date()): DispatchResult {
      return tx(db, () => {
        const r = dispatchOne(taskId, o, now);
        touchInteraction(db, now);
        return r;
      });
    },

    /** "Dárselas a Claude": one transaction; sample cards are skipped, not refused. */
    dispatchMany(ids: string[], o: { kind?: DispatchKind } = {}, now = new Date()): BatchDispatchResult {
      return tx(db, () => {
        const out: BatchDispatchResult = { results: [], skipped: [] };
        for (const id of [...new Set(ids)]) {
          if (tasks.get(id).isSample) out.skipped.push({ id, reason: "sample" });
          else out.results.push(dispatchOne(id, o, now));
        }
        touchInteraction(db, now);
        return out;
      });
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
        const r = dispatchOne(task.id, { kind }, now);
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
