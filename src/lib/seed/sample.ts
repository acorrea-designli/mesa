// Sample data ("Datos de muestra.") that puts every screen of the mocks in every state.
// Pure seeding logic over the repositories; scripts/seed.ts is the CLI (`pnpm seed [--reset]`).
//
// Safety rules:
// - Every row is flagged is_sample (directly, or through ON DELETE CASCADE from a sample
//   ticket, salida or review), so resetSamples() never touches real rows.
// - Sample tickets and salidas are owned by SAMPLE_SESSION, a session nobody runs. Any wake
//   the server emits later for a sample (undo window over, schedule reached, source back)
//   targets that session, never the lead and never "any session".
// - Wake events the repositories emit while seeding are deleted before the transaction commits.
// - Sample tasks get a final sync state through tasks.markSync (never pushed to GitHub).
// - source_state is never written.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { formatEventBody } from "../domain/calendar-event";
import type { Destination, Mark, MarkKind, SalidaLink, Source, Station, SyncState } from "../domain/types";
import { addDays, localDay, mondayOf } from "../domain/week";
import type { Repos } from "../repo";
import type { SalidaInput } from "../repo/salidas";

/** The session that owns every sample ticket and salida. No Claude session uses this id. */
export const SAMPLE_SESSION = "mesa-sample";

const MIN = 60_000;
const at = (now: Date, min: number) => new Date(now.getTime() + min * MIN);
const iso = (now: Date, min: number) => at(now, min).toISOString();

// Clearly fictional links (never real repos, workspaces or recordings).
const gh = (repo: string, n: number) => `https://github.com/example-org/${repo}/pull/${n}`;
const slackUrl = (channelId: string, ts: string) => `https://example.slack.com/archives/${channelId}/p${ts.replace(".", "")}`;
const bcUrl = (bucket: number, recording: number) => `https://basecamp.example.com/0000000/buckets/${bucket}/recordings/${recording}`;

const ME = "Andrés Correa";
const WORKSPACE = "designli.slack.com";

const slackThread = (channel: string, channelId: string, threadTs: string, threadLabel: string): Destination => ({
  kind: "slack_thread",
  workspace: WORKSPACE,
  channel,
  channelId,
  threadTs,
  threadLabel,
  postAs: ME,
});

const mark = (body: string, text: string, kind: MarkKind): Mark => {
  const start = body.indexOf(text);
  if (start < 0) throw new Error(`sample mark text not found: ${text}`);
  return { start, end: start + text.length, kind, text };
};

// ---------- reset ----------

const SAMPLE_ENTITY_IDS = `
  SELECT id FROM tickets WHERE is_sample = 1
  UNION SELECT id FROM salidas WHERE is_sample = 1
  UNION SELECT id FROM tasks WHERE is_sample = 1
  UNION SELECT id FROM reviews WHERE is_sample = 1`;

function purgeSampleWakes(db: Db): number {
  return Number(
    db.prepare(`DELETE FROM wake_events WHERE entity_id IN (${SAMPLE_ENTITY_IDS}) OR session_id = ?`).run(SAMPLE_SESSION)
      .changes,
  );
}

export interface ResetResult {
  calendarEvents: number;
  wakeEvents: number;
  reviews: number;
  approvals: number;
  engramLinks: number;
  chips: number;
  salidas: number;
  tickets: number;
  items: number;
  tasks: number;
}

/** Delete every sample row (and what cascades from it). Real rows are never touched. */
export function resetSamples(db: Db): ResetResult {
  return tx(db, () => {
    const del = (sql: string, ...args: string[]) => Number(db.prepare(sql).run(...args).changes);
    const wakeEvents = purgeSampleWakes(db);
    const engramLinks = del(
      `DELETE FROM engram_links WHERE is_sample = 1 OR entity_id IN (SELECT id FROM tickets WHERE is_sample = 1
         UNION SELECT id FROM salidas WHERE is_sample = 1 UNION SELECT id FROM tasks WHERE is_sample = 1)`,
    );
    const out: ResetResult = {
      calendarEvents: del("DELETE FROM calendar_events WHERE is_sample = 1"),
      wakeEvents,
      reviews: del("DELETE FROM reviews WHERE is_sample = 1"), // findings cascade
      approvals: del("DELETE FROM approvals WHERE is_sample = 1"),
      engramLinks,
      chips: del("DELETE FROM learned_chips WHERE is_sample = 1"),
      salidas: del("DELETE FROM salidas WHERE is_sample = 1"), // versions and turns cascade
      tickets: del("DELETE FROM tickets WHERE is_sample = 1"), // messages, refs, plan, brief, handoffs, team cascade
      items: del("DELETE FROM items WHERE is_sample = 1"),
      tasks: del("DELETE FROM tasks WHERE is_sample = 1"),
    };
    del("DELETE FROM sessions WHERE id = ?", SAMPLE_SESSION);
    return out;
  });
}

// ---------- seed ----------

export interface SeedResult {
  calendarEvents: number;
  items: number;
  tasks: number;
  tickets: number;
  salidas: number;
  approvals: number;
  reviews: number;
  findings: number;
  chips: number;
  agents: number;
  handoffs: number;
  briefs: number;
  engramLinks: number;
}

interface ItemSpec {
  source: Source;
  externalId: string;
  kind: string;
  title: string;
  excerpt: string;
  project: string;
  url: string | null;
  need: string;
  min: number;
  tag?: string;
  meta?: Record<string, unknown>;
}

interface CardSpec {
  source: Source;
  station: Station;
  title: string;
  excerpt: string;
  project: string;
  waitOn: string;
  min: number;
  sync: SyncState;
  syncError?: string;
  items: ItemSpec[];
  /** The ticket whose item_id should point at the card's first item. */
  ticketId?: string;
}

/**
 * Insert the sample set. Removes previous samples first, so running it twice never
 * duplicates. Everything runs in one transaction: other connections never see the
 * intermediate wake events.
 */
export function seedSamples(repos: Repos, now: Date = new Date()): SeedResult {
  const { db } = repos;
  return tx(db, () => {
    resetSamples(db);
    repos.sessions.touch({ id: SAMPLE_SESSION, label: "Datos de muestra" }, at(now, -24 * 60));

    const tk = seedTickets(repos, now);
    seedBoard(repos, now, tk);
    const extraSalidas = seedSalidasAndReviews(repos, now, tk);
    const approvalIds = seedApprovals(repos, now, tk);
    seedAgents(repos, now, tk);
    const engramIds = seedEngram(repos, now, tk);
    seedChips(db, now);
    seedCalendar(repos, now);

    const flag = (table: string, ids: string[]) => {
      for (const id of ids) db.prepare(`UPDATE ${table} SET is_sample = 1 WHERE id = ?`).run(id);
    };
    flag("approvals", approvalIds);
    flag("engram_links", engramIds);
    // Salidas created by review actions do not take isSample or an owner: claim them.
    for (const id of extraSalidas) {
      db.prepare("UPDATE salidas SET is_sample = 1, owner_session = ? WHERE id = ?").run(SAMPLE_SESSION, id);
    }
    purgeSampleWakes(db);
    // The sample session must not look like a live listener.
    db.prepare("UPDATE sessions SET last_seen_at = ?, waiting_since = NULL WHERE id = ?").run(iso(now, -24 * 60), SAMPLE_SESSION);

    return sampleCounts(db);
  });
}

export function sampleCounts(db: Db): SeedResult {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const onSampleTicket = (table: string) =>
    n(`SELECT COUNT(*) AS n FROM ${table} WHERE ticket_id IN (SELECT id FROM tickets WHERE is_sample = 1)`);
  return {
    calendarEvents: n("SELECT COUNT(*) AS n FROM calendar_events WHERE is_sample = 1"),
    items: n("SELECT COUNT(*) AS n FROM items WHERE is_sample = 1"),
    tasks: n("SELECT COUNT(*) AS n FROM tasks WHERE is_sample = 1"),
    tickets: n("SELECT COUNT(*) AS n FROM tickets WHERE is_sample = 1"),
    salidas: n("SELECT COUNT(*) AS n FROM salidas WHERE is_sample = 1"),
    approvals: n("SELECT COUNT(*) AS n FROM approvals WHERE is_sample = 1"),
    reviews: n("SELECT COUNT(*) AS n FROM reviews WHERE is_sample = 1"),
    findings: n("SELECT COUNT(*) AS n FROM review_findings WHERE review_id IN (SELECT id FROM reviews WHERE is_sample = 1)"),
    chips: n("SELECT COUNT(*) AS n FROM learned_chips WHERE is_sample = 1"),
    agents: onSampleTicket("ticket_team"),
    handoffs: onSampleTicket("ticket_handoffs"),
    briefs: onSampleTicket("ticket_briefs"),
    engramLinks: n("SELECT COUNT(*) AS n FROM engram_links WHERE is_sample = 1"),
  };
}

// ---------- tickets ----------

interface SampleTickets {
  b12: { id: string; ref: string };
  a16: { id: string; ref: string };
  b14: { id: string; ref: string };
  b15: { id: string; ref: string };
  b13: { id: string; ref: string };
  a22: { id: string; ref: string };
  b10: { id: string; ref: string };
  a19: { id: string; ref: string };
  a21: { id: string; ref: string };
  a17: { id: string; ref: string };
}

function seedTickets(repos: Repos, now: Date): SampleTickets {
  const T = repos.tickets;
  const own = { ownerSession: SAMPLE_SESSION, isSample: true };
  const pick = (d: { id: string; ref: string }) => ({ id: d.id, ref: d.ref });

  // Closed: Claude asked, Andrés chose A, Claude closed it.
  const b12 = pick(
    T.create(
      {
        ...own,
        direction: "claude_asks",
        title: "¿Uso la plantilla vieja de factura?",
        project: "freightmate",
        body: "La maqueta de facturas de Freightmate puede salir con la plantilla vieja o con la nueva de Designli.",
        options: [
          { key: "A", label: "La plantilla vieja", detail: "La que Dana usa desde marzo" },
          { key: "B", label: "La plantilla nueva", detail: "Hay que volver a aprobar el logo" },
        ],
        recommended: "A",
        recommendation: "Dana pidió no cambiar el formato a mitad de mes.",
      },
      at(now, -157),
    ),
  );
  T.addMessage(b12.id, { author: "andres", body: "A.", chosen: "A" }, at(now, -155));
  T.addMessage(b12.id, { author: "claude", body: "Listo: la maqueta usa la plantilla vieja. Quedó en Basecamp para Dana.", session: SAMPLE_SESSION }, at(now, -150));
  T.transition(b12.id, { type: "close", by: "claude" }, undefined, at(now, -149));

  // Closed: Andrés asked, Claude worked and closed with a summary.
  const a16 = pick(
    T.create(
      {
        ...own,
        direction: "andres_asks",
        title: "Revisa las tarifas nuevas de Freightmate",
        project: "freightmate",
        body: "Dana mandó la tabla nueva en Basecamp. Revisa si cambia algo en el cálculo por milla.",
      },
      at(now, -171),
    ),
  );
  T.transition(a16.id, { type: "claim" }, SAMPLE_SESSION, at(now, -170));
  T.addMessage(
    a16.id,
    {
      author: "claude",
      body: "Resumen: la tarifa base sube 4 % y el recargo por combustible pasa a ser por milla. El cálculo actual ya lo soporta; solo cambia la tabla.",
      session: SAMPLE_SESSION,
    },
    at(now, -132),
  );
  T.transition(a16.id, { type: "close", by: "claude" }, undefined, at(now, -131));

  // Waiting on Andrés: A/B choice with a recommendation, refs and the client's own words.
  const b14 = pick(
    T.create(
      {
        ...own,
        direction: "claude_asks",
        title: "¿Cierro el to-do de Bseen o espero QA?",
        project: "bseen",
        body:
          "El to-do «Ajustar onboarding, paso 2» ya está en staging. Laura (QA) aún no lo revisa.\n\n" +
          '> Dana Whitfield, 28 oct: "Please run it by QA before you close anything on onboarding."',
        options: [
          { key: "A", label: "Cerrar el to-do ahora", detail: "El cliente lo ve como hecho hoy" },
          { key: "B", label: "Esperar a QA", detail: "Y recordarle a Laura mañana 09:00" },
        ],
        recommended: "B",
        recommendation: "el cliente pidió ver QA antes de cerrar (mensaje del 28 oct).",
        refs: [
          { refType: "url", target: bcUrl(2001, 7001), label: "Basecamp · Bseen · To-do" },
          { refType: "ticket", target: b12.id, label: `@${b12.ref} plantilla vieja de factura` },
        ],
      },
      at(now, -37),
    ),
  );

  const b15 = pick(
    T.create(
      {
        ...own,
        direction: "claude_asks",
        title: "¿Le contesto a Matt por escrito o pido llamada?",
        project: "scout",
        body: "Matt quiere confirmar la env var antes del deploy de prod de las 2pm. Ya hay un borrador en Salidas.",
        options: [
          { key: "A", label: "Por escrito en el hilo", detail: "El borrador ya está en Salidas" },
          { key: "B", label: "Pedir una llamada de 10 min", detail: "Si hay dudas con el deploy de prod" },
        ],
        recommended: "A",
        recommendation: "Matt solo necesita la confirmación; una llamada retrasaría el deploy.",
        refs: [{ refType: "url", target: slackUrl("C0SAMPLE01", "1730640660.118000"), label: "Slack #scout-dev · hilo de deploy" }],
      },
      at(now, -20),
    ),
  );

  const b13 = pick(
    T.create(
      {
        ...own,
        direction: "claude_asks",
        title: "PR #212: ¿pido tests del export o apruebo?",
        project: "prospec-admin",
        body: "El monitor dejó 2 hallazgos abiertos en el export masivo: un blocker y un nit.",
        options: [
          { key: "A", label: "Pedir tests del export", detail: "Comento el blocker y espero al autor" },
          { key: "B", label: "Aprobar igual", detail: "Y abro un to-do para los tests" },
        ],
        recommended: "A",
        recommendation: "el export no tiene tests y el blocker puede dejar archivos a medias.",
        refs: [{ refType: "url", target: gh("prospec-admin", 212), label: "PR #212 feat: bulk export" }],
      },
      at(now, -62),
    ),
  );

  // Waiting on Andrés: a card of three questions; he answered the first one, the other two stay open.
  const b16 = pick(
    T.create(
      {
        ...own,
        direction: "claude_asks",
        title: "Release de Scout: tres decisiones",
        project: "scout",
        body: "Antes de cortar la release 2.4 de Scout necesito tres decisiones.",
        questions: [
          {
            text: "¿Cuándo corto la release?",
            options: [
              { key: "A", label: "Hoy a las 17:00", detail: "Con lo que está en main" },
              { key: "B", label: "Mañana 09:00", detail: "Entra el fix de Laura" },
              { key: "C", label: "El lunes", detail: "Con el QA completo" },
            ],
            recommended: "B",
            recommendation: "el fix de Laura cierra el bug que vio Matt.",
          },
          {
            text: "¿Quién avisa al cliente?",
            options: [
              { key: "A", label: "Yo por Slack", detail: "Pasa por Salidas" },
              { key: "B", label: "Tú en la llamada del jueves" },
            ],
            recommended: "A",
            recommendation: "Matt pidió el aviso por escrito.",
          },
          {
            text: "¿Qué hago con el flag de exportar?",
            options: [
              { key: "A", label: "Dejarlo apagado" },
              { key: "B", label: "Encenderlo solo para Scout" },
              { key: "C", label: "Encenderlo para todos" },
              { key: "D", label: "Quitarlo del código" },
            ],
            recommended: "B",
            recommendation: "Scout lo pidió y nadie más lo ha probado.",
          },
        ],
      },
      at(now, -14),
    ),
  );
  const [b16q1] = T.detail(b16.id).questions;
  T.addMessage(b16.id, { author: "andres", body: "", answers: [{ questionId: b16q1!.id, chosen: "B" }] }, at(now, -12));

  // Waiting on Andrés: a request whose plan has direct actions and one that needs his OK.
  const a22 = pick(
    T.create(
      {
        ...own,
        direction: "andres_asks",
        title: "Cancela la respuesta a Matt y ordena el export de prospec",
        project: "buckhub",
        body:
          "Cancela la respuesta a Matt, mueve el export de prospec a Esperando y crea una tarea para revisar " +
          "el lockfile de buckhub con el log adjunto.",
        refs: [
          { refType: "ticket", target: b13.id, label: `@${b13.ref} PR #212 export` },
          { refType: "url", target: slackUrl("C0SAMPLE03", "1730639100.000400"), label: "Slack #buckhub-dev · hilo de Matt 09:05" },
        ],
      },
      at(now, -6),
    ),
  );
  T.plan(
    a22.id,
    [
      { kind: "cancel_salida", source: "slack", mode: "direct", label: "Cancelar salida · respuesta a Matt", target: { detail: "Slack #scout-dev · hilo de deploy · aún no enviada" } },
      { kind: "move_card", source: "github", mode: "direct", label: "Mover en el tablero · Export CSV", target: { detail: "prospec-admin · En curso → Esperando" } },
      { kind: "create_task", source: "claude", mode: "direct", label: "Crear tarea · Revisar lockfile de buckhub", target: { detail: "Todo · con build-main-1103.log" } },
      { kind: "send_message", source: "basecamp", mode: "needs_ok", label: "Escribir al cliente si el lockfile es la causa", target: { detail: "Basecamp · Buckhub · pasa por Salidas" } },
    ],
    SAMPLE_SESSION,
    at(now, -5),
  );

  // Waiting on Claude: Andrés answered a choice.
  const b10 = pick(
    T.create(
      {
        ...own,
        direction: "claude_asks",
        title: "¿Pinneo pnpm 9 en el CI de buckhub?",
        project: "buckhub",
        body: "El CI de buckhub instala la última pnpm y el lockfile cambió de formato tras el bump de next.",
        options: [
          { key: "A", label: "Pinnear pnpm 9", detail: "Cambio de una línea en el workflow" },
          { key: "B", label: "Subir todo a pnpm 10", detail: "Regenera el lockfile" },
        ],
        recommended: "A",
        recommendation: "es el cambio más chico y desbloquea el build hoy.",
      },
      at(now, -48),
    ),
  );
  T.addMessage(b10.id, { author: "andres", body: "A, y deja una nota en el README.", chosen: "A" }, at(now, -45));

  // Working, no wake yet.
  const a19 = pick(
    T.create(
      {
        ...own,
        direction: "andres_asks",
        title: "Resume los hilos de Buckhub de la semana",
        project: "buckhub",
        body: "Resúmeme lo que pasó esta semana en #buckhub-dev y en Basecamp, con lo que me toca a mí.",
      },
      at(now, -90),
    ),
  );
  T.transition(a19.id, { type: "claim" }, SAMPLE_SESSION, at(now, -89));

  // Working after a wake ("Claude trabaja · despertó …"), with a direct plan in progress.
  const a21 = pick(
    T.create(
      {
        ...own,
        direction: "andres_asks",
        title: "Investigar el 502 en buckhub staging",
        project: "buckhub",
        body: "Staging de buckhub da 502 desde las 8. Revisa los logs y dime qué es.",
      },
      at(now, -112),
    ),
  );
  T.transition(a21.id, { type: "claim" }, SAMPLE_SESSION, at(now, -111));
  T.addMessage(
    a21.id,
    { author: "claude", body: "Es el health check: tarda 6 s en frío y el balanceador corta a los 5 s. ¿Subo el timeout a 10 s?", session: SAMPLE_SESSION },
    at(now, -104),
  );
  T.addMessage(a21.id, { author: "andres", body: "Dale, sube el timeout y avísale a Matt." }, at(now, -100));
  const planned = T.plan(
    a21.id,
    [
      { kind: "investigate", source: "claude", mode: "direct", label: "Leer los logs de staging", target: {} },
      { kind: "other", source: "github", mode: "direct", label: "Subir el timeout del health check a 10 s", target: { repo: "example-org/buckhub" } },
    ],
    SAMPLE_SESSION,
    at(now, -99),
  );
  const [first, second] = planned.actions;
  if (first) T.setActionState(first.id, "done", at(now, -95));
  if (second) T.setActionState(second.id, "running", at(now, -94));

  // Working after a wake, with history: produced the many-versions salida.
  const a17 = pick(
    T.create(
      {
        ...own,
        direction: "andres_asks",
        title: "Revisar la env var de Scout antes del deploy",
        project: "scout",
        body: "Revisa que SCOUT_API_URL esté bien en staging antes de que Matt despliegue.",
        refs: [{ refType: "url", target: slackUrl("C0SAMPLE01", "1730640660.118000"), label: "Slack #scout-dev · hilo de deploy" }],
      },
      at(now, -112),
    ),
  );
  T.transition(a17.id, { type: "claim" }, SAMPLE_SESSION, at(now, -111));
  T.addMessage(
    a17.id,
    {
      author: "claude",
      body: "Leí los logs: `SCOUT_API_URL missing, falling back to http://localhost:4000`. Abro un PR que la añade a staging; prod no se toca hasta las 2pm.",
      session: SAMPLE_SESSION,
      refs: [{ refType: "url", target: gh("scout", 59), label: "PR #59" }],
    },
    at(now, -97),
  );
  T.addMessage(a17.id, { author: "andres", body: "¿La pongo también en prod?" }, at(now, -96.5));
  T.addMessage(
    a17.id,
    { author: "claude", body: "Todavía no: Matt despliega prod después de las 2pm y la variable entra con ese deploy.", session: SAMPLE_SESSION },
    at(now, -96),
  );
  T.addMessage(a17.id, { author: "andres", body: "Dale. Cuando Matt redespliegue, prepárame la respuesta del hilo." }, at(now, -95));
  T.transition(a17.id, { type: "claim" }, SAMPLE_SESSION, at(now, -94));

  return { b12, a16, b14, b15, b13, a22, b10, a19, a21, a17 };
}

// ---------- items and tasks ----------

function seedBoard(repos: Repos, now: Date, tk: SampleTickets): void {
  const { db } = repos;
  const pr = (repo: string, n: number, title: string, excerpt: string, min: number, extra: Partial<ItemSpec> = {}): ItemSpec => ({
    source: "github",
    externalId: `sample:pr:example-org/${repo}#${n}`,
    kind: "pr_review",
    title: `${repo} #${n} · ${title}`,
    excerpt,
    project: repo,
    url: gh(repo, n),
    need: "approve_pr",
    min,
    ...extra,
  });
  const slack = (channel: string, channelId: string, ts: string, title: string, excerpt: string, project: string, min: number): ItemSpec => ({
    source: "slack",
    externalId: `sample:slack:${channelId}:${ts}`,
    kind: "mention",
    title,
    excerpt,
    project,
    url: slackUrl(channelId, ts),
    need: "reply",
    min,
    meta: { channel },
  });
  const bc = (recording: number, title: string, excerpt: string, project: string, min: number, kind = "request"): ItemSpec => ({
    source: "basecamp",
    externalId: `sample:basecamp:${recording}`,
    kind,
    title,
    excerpt,
    project,
    url: bcUrl(1001, recording),
    need: "reply",
    min,
  });
  const claude = (t: { id: string; ref: string } | null, key: string, title: string, excerpt: string, project: string, min: number, need = "decision"): ItemSpec => ({
    source: "claude",
    externalId: `sample:claude:${key}`,
    kind: t ? "question" : "message",
    title,
    excerpt,
    project,
    url: null,
    need,
    min,
    meta: t ? { ticketRef: t.ref } : {},
  });

  const cards: CardSpec[] = [
    // Inbox
    { source: "basecamp", station: "inbox", title: "Cambio en tarifa por milla", excerpt: '"¿Pueden tenerlo para el viernes? El cliente lo pidió ayer"', project: "freightmate", waitOn: "you", min: -147, sync: "synced",
      items: [bc(5001, "Freightmate · cambio en tarifa por milla", '"¿Pueden tenerlo para el viernes? El cliente lo pidió ayer"', "freightmate", -147)] },
    { source: "github", station: "inbox", title: "#212 feat: bulk export", excerpt: "Review solicitado · +418 −36 · monitor: 2 hallazgos", project: "prospec-admin", waitOn: "you", min: -100, sync: "synced",
      items: [
        pr("prospec-admin", 212, "feat: bulk export", "Review solicitado · +418 −36 · monitor: 2 hallazgos", -100, { meta: { additions: 418, deletions: 36, findings: 2 } }),
        bc(5002, "Prospec · export masivo para el cierre", '"¿El export sale esta semana? Lo necesitamos para el cierre."', "prospec-admin", -98),
      ] },
    { source: "slack", station: "inbox", title: "Hilo de deploy: confirmar env var", excerpt: 'Matt: "andres can you confirm the env var before 2pm?"', project: "scout", waitOn: "you", min: -71, sync: "synced",
      items: [slack("#scout-dev", "C0SAMPLE01", "1730640660.118000", "#scout-dev · hilo de deploy", 'Matt: "andres can you confirm the env var before 2pm?"', "scout", -71)] },
    { source: "claude", station: "inbox", title: "¿Cierro el to-do de Bseen o espero QA?", excerpt: `Claude pregunta · ticket ${tk.b14.ref}`, project: "bseen", waitOn: "you", min: -37, sync: "synced", ticketId: tk.b14.id,
      items: [claude(tk.b14, "b14", "¿Cierro el to-do de Bseen o espero QA?", `Ticket ${tk.b14.ref} · Claude pregunta`, "bseen", -37)] },
    { source: "github", station: "inbox", title: "#88 fix: token refresh", excerpt: "Monitor: sin hallazgos · listo para aprobar", project: "buckhub", waitOn: "you", min: -22, sync: "pending",
      items: [pr("buckhub", 88, "fix: token refresh", "Monitor: sin hallazgos · listo para aprobar", -22, { tag: "clean" })] },
    // Todo
    { source: "basecamp", station: "todo", title: "Exportar reporte semanal a PDF", excerpt: '"The client wants it in the Monday email"', project: "scout", waitOn: "you", min: -3 * 24 * 60, sync: "synced",
      items: [bc(5003, "Scout · exportar reporte semanal a PDF", '"The client wants it in the Monday email"', "scout", -3 * 24 * 60)] },
    { source: "github", station: "todo", title: "#341 chore: bump prisma to 6.2", excerpt: "Review solicitado · +88 −71", project: "freightmate-api", waitOn: "you", min: -54, sync: "synced",
      items: [pr("freightmate-api", 341, "chore: bump prisma to 6.2", "Review solicitado · +88 −71", -54)] },
    { source: "slack", station: "todo", title: "Suavizar el copy del onboarding", excerpt: 'Cliente: "can we soften the second screen?"', project: "bseen", waitOn: "you", min: -26 * 60, sync: "synced",
      items: [slack("#bseen-client", "C0SAMPLE04", "1730560000.000200", "#bseen-client · copy del onboarding", 'Cliente: "can we soften the second screen?"', "bseen", -26 * 60)] },
    { source: "claude", station: "todo", title: "Resumir los hilos de Buckhub de la semana", excerpt: `Pediste · ticket ${tk.a19.ref}`, project: "buckhub", waitOn: "claude", min: -90, sync: "synced", ticketId: tk.a19.id,
      items: [claude(tk.a19, "a19", "Resumir los hilos de Buckhub de la semana", `Pediste · ticket ${tk.a19.ref}`, "buckhub", -90, "reply")] },
    // Doing
    { source: "github", station: "doing", title: "#208 feat: filtros guardados", excerpt: "Pediste cambios · 3 hilos abiertos", project: "prospec-admin", waitOn: "person:autor", min: -25 * 60, sync: "synced",
      items: [pr("prospec-admin", 208, "feat: filtros guardados", "Pediste cambios · 3 hilos abiertos", -25 * 60)] },
    { source: "claude", station: "doing", title: "Borrador de respuesta a Freightmate", excerpt: "Claude redacta · saldrá a tu firma", project: "freightmate", waitOn: "claude", min: -4, sync: "synced",
      items: [claude(null, "draft-freightmate", "Borrador de respuesta a Freightmate", "Claude redacta · saldrá a tu firma", "freightmate", -4, "approve")] },
    { source: "basecamp", station: "doing", title: "Ajustar onboarding, paso 2", excerpt: "To-do asignado · vence el jueves", project: "bseen", waitOn: "you", min: -2 * 24 * 60, sync: "error",
      syncError: "gh: HTTP 401 Bad credentials (el token de gh venció)",
      items: [bc(7001, "Bseen · ajustar onboarding, paso 2", "To-do asignado · vence el jueves", "bseen", -2 * 24 * 60, "todo")] },
    { source: "slack", station: "doing", title: "Script de migración de tarifas", excerpt: 'Matt: "ping me when the script is ready"', project: "freightmate", waitOn: "you", min: -122, sync: "synced",
      items: [slack("#freightmate-dev", "C0SAMPLE05", "1730633000.000300", "#freightmate-dev · script de migración", 'Matt: "ping me when the script is ready"', "freightmate", -122)] },
    // Waiting
    { source: "basecamp", station: "waiting", title: "Aprobar maqueta de facturas", excerpt: "Enviado al cliente ayer, 17:20", project: "freightmate", waitOn: "client", min: -20 * 60, sync: "synced",
      items: [bc(5004, "Freightmate · aprobar maqueta de facturas", "Enviado al cliente ayer, 17:20", "freightmate", -20 * 60)] },
    { source: "github", station: "waiting", title: "#57 fix: zona horaria en reportes", excerpt: "Aprobado · falta el deploy de Matt", project: "scout", waitOn: "person:Matt", min: -92, sync: "synced",
      items: [
        pr("scout", 57, "fix: zona horaria en reportes", "Aprobado · falta el deploy de Matt", -92),
        slack("#scout-dev", "C0SAMPLE01", "1730638200.000500", "#scout-dev · deploy de #57", 'Matt: "deploying #57 after lunch"', "scout", -90),
      ] },
    { source: "slack", station: "waiting", title: "Acceso a #buckhub-design", excerpt: "Le pediste a Matt que te invite al canal", project: "buckhub", waitOn: "person:Matt", min: -65, sync: "synced",
      items: [slack("#buckhub-dev", "C0SAMPLE03", "1730643000.000800", "#buckhub-dev · acceso a #buckhub-design", 'Tú: "Matt, can you add me to #buckhub-design?"', "buckhub", -65)] },
    { source: "claude", station: "waiting", title: "Investigar el 502 en buckhub staging", excerpt: `Claude revisa los logs · ticket ${tk.a21.ref}`, project: "buckhub", waitOn: "claude", min: -112, sync: "pending", ticketId: tk.a21.id,
      items: [claude(tk.a21, "a21", "Investigar el 502 en buckhub staging", `Pediste · ticket ${tk.a21.ref}`, "buckhub", -112, "reply")] },
    // Done
    { source: "github", station: "done", title: "#55 feat: CSV de visitas", excerpt: "Aprobado y mergeado", project: "scout", waitOn: "none", min: -30, sync: "synced",
      items: [pr("scout", 55, "feat: CSV de visitas", "Aprobado y mergeado", -30)] },
    { source: "basecamp", station: "done", title: "Confirmar fecha de demo", excerpt: "Demo el jueves 10:00", project: "bseen", waitOn: "none", min: -44, sync: "synced",
      items: [bc(5005, "Bseen · confirmar fecha de demo", "Demo el jueves 10:00", "bseen", -44)] },
    { source: "slack", station: "done", title: "Respuesta a Matt sobre staging", excerpt: "Enviada · el 502 era el health check", project: "buckhub", waitOn: "none", min: -32, sync: "synced",
      items: [slack("#buckhub-dev", "C0SAMPLE03", "1730642280.000600", "#buckhub-dev · staging caído", 'Matt: "is staging down for you too?"', "buckhub", -82)] },
    { source: "claude", station: "done", title: `Ticket ${tk.a16.ref}: revisar tarifas`, excerpt: "Hecho por Claude · resumen en el ticket", project: "freightmate", waitOn: "none", min: -131, sync: "synced", ticketId: tk.a16.id,
      items: [claude(tk.a16, "a16", "Revisa las tarifas nuevas de Freightmate", `Pediste · ticket ${tk.a16.ref}`, "freightmate", -171, "reply")] },
  ];

  const createItem = (s: ItemSpec, station: Station, waitOn: string) =>
    repos.items.create(
      {
        source: s.source,
        externalId: s.externalId,
        kind: s.kind,
        title: s.title,
        excerpt: s.excerpt,
        project: s.project,
        url: s.url,
        need: s.need,
        station,
        waitOn,
        tag: s.tag ?? null,
        meta: { ...(s.meta ?? {}), sample: true },
        isSample: true,
        receivedAt: iso(now, s.min),
      },
      at(now, s.min),
    );

  let ghSeq = 0;
  cards.forEach((c, i) => {
    const items = c.items.map((s) => createItem(s, c.station, c.waitOn));
    const task = repos.tasks.create(
      {
        title: c.title,
        source: c.source,
        excerpt: c.excerpt,
        project: c.project,
        station: c.station,
        waitOn: c.waitOn,
        position: i + 1,
        isSample: true,
        itemIds: items.map((x) => x.id),
      },
      at(now, c.min),
    );
    // Never pushed to the real GitHub Project: the final state is set here.
    if (c.sync === "synced") {
      ghSeq += 1;
      repos.tasks.markSync(
        task.id,
        { syncState: "synced", ghItemId: `SAMPLE_PVTI_${String(ghSeq).padStart(3, "0")}`, ghContentUrl: c.source === "github" ? (items[0]?.url ?? null) : null },
        at(now, Math.min(c.min + 1, -2)),
      );
    } else if (c.sync === "error") {
      repos.tasks.markSync(task.id, { syncState: "error", syncError: c.syncError }, at(now, -11));
    } else {
      repos.tasks.markSync(task.id, { syncState: c.sync }, at(now, -1));
    }
    const first = items[0];
    if (c.ticketId && first) db.prepare("UPDATE tickets SET item_id = ? WHERE id = ?").run(first.id, c.ticketId);
  });

  // Hoy-only items (no card yet): two Claude questions and a Basecamp mention.
  const b13Item = createItem(claude(tk.b13, "b13", "PR #212: ¿pido tests del export o apruebo?", `Ticket ${tk.b13.ref} · monitor: 2 hallazgos`, "prospec-admin", -62), "inbox", "you");
  db.prepare("UPDATE tickets SET item_id = ? WHERE id = ?").run(b13Item.id, tk.b13.id);
  const b15Item = createItem(claude(tk.b15, "b15", "¿Le contesto a Matt por escrito o pido llamada?", `Ticket ${tk.b15.ref} · hilo de deploy en #scout-dev`, "scout", -20), "inbox", "you");
  db.prepare("UPDATE tickets SET item_id = ? WHERE id = ?").run(b15Item.id, tk.b15.id);
  createItem(bc(5006, "Scout · te mencionaron en «Reporte semanal»", '"Andrés, ¿lo vemos el lunes en el correo de las 8?"', "scout", -15, "mention"), "inbox", "you");
}

// ---------- calendar (t112) ----------

/**
 * A fictional week of meetings around `now` (Bogota days) and one calendar salida waiting for a signature, so Calendario,
 * the "Próxima reunión" strip and the calendar salida card show in the sandbox without any read of Google.
 * Meeting times are fixed clock times of each day, so the "next meeting" depends on when the seed runs.
 */
function seedCalendar(repos: Repos, now: Date): void {
  const mon = mondayOf(localDay(now));
  const att = (...p: [string, string, "accepted" | "declined" | "needs_action"][]) => p.map(([email, name, response]) => ({ email, name, response }));
  const ME_ATT = ["andres@example.com", "Andrés", "accepted"] as [string, string, "accepted"];
  const people = att(ME_ATT, ["laura@example.com", "Laura", "accepted"], ["matt.r@scoutapp.example", "Matt", "accepted"], ["sofia@example.com", "Sofía", "needs_action"]);
  const make = (dayN: number, from: string, to: string, title: string, o: { n?: number; meet?: boolean; declined?: boolean; allDay?: boolean; recurring?: boolean } = {}) => {
    const day = addDays(mon, dayN);
    const start = new Date(`${day}T${from}:00-05:00`).toISOString();
    const end = new Date(o.allDay ? `${addDays(day, 1)}T00:00:00-05:00` : `${day}T${to}:00-05:00`).toISOString();
    return {
      uid: `sample-${day}-${from}-${title}`,
      occurrenceKey: start,
      title,
      startsAt: start,
      endsAt: end,
      allDay: Boolean(o.allDay),
      timeZone: "America/Bogota",
      location: null,
      meetUrl: o.meet === false ? null : `https://meet.google.com/sample-${(dayN * 7 + from.length + title.length).toString(36)}-demo`,
      attendees: people.slice(0, Math.max(1, o.n ?? 2)).map((a) => (o.declined && a.email === ME_ATT[0] ? { ...a, response: "declined" as const } : a)),
      organizer: "matt.r@scoutapp.example",
      response: o.declined ? ("declined" as const) : ("accepted" as const),
      status: "confirmed" as const,
      recurring: Boolean(o.recurring),
    };
  };
  const events: ReturnType<typeof make>[] = [];
  for (let d = 0; d < 5; d++) events.push(make(d, "09:00", "09:15", "Standup Designli", { n: 4, recurring: true }));
  events.push(
    make(0, "11:00", "12:00", "Planning semanal", { n: 4 }),
    make(0, "15:00", "15:45", "Review buckhub", { n: 3 }),
    make(1, "10:00", "10:30", "Sync Bseen"),
    make(1, "14:00", "15:00", "Demo Scout", { n: 4 }),
    make(2, "10:30", "11:00", "Sync Scout con Matt"),
    make(2, "14:00", "14:45", "Demo Freightmate", { n: 3, declined: true }),
    make(2, "15:00", "15:30", "Revisión de onboarding Bseen", { n: 4 }),
    make(2, "16:30", "17:00", "1:1 con Laura"),
    make(2, "17:30", "18:00", "Planning prospec-admin", { n: 4 }),
    make(2, "00:00", "00:00", "Cumpleaños de Laura", { allDay: true, meet: false, n: 1 }),
    make(3, "11:00", "11:45", "Demo Freightmate", { n: 3 }),
    make(3, "14:00", "14:30", "Review buckhub", { n: 3 }),
    make(4, "10:00", "11:00", "Retro semanal", { n: 4, recurring: true }),
  );
  repos.calendar.replaceSamples(events, now);

  // One event waiting for his signature (the card of Salidas): Thursday 10:00, Matt, with Meet.
  const thu = addDays(mon, 3);
  const body = formatEventBody({ title: "Meet con Matt", start: `${thu}T10:00:00-05:00`, end: `${thu}T10:30:00-05:00`, timeZone: "America/Bogota", invitees: ["matt.r@scoutapp.example"], meet: true });
  repos.salidas.create(
    {
      source: "calendar",
      destination: { kind: "calendar_event", calendar: "primary", invitees: ["matt.r@scoutapp.example"], meet: true, postAs: ME },
      body,
      title: "Evento: Meet con Matt",
      context: 'Tú: "meet con Matt el jueves 30 min". Claude: el jueves 10:00 está libre; el correo de Matt viene del hilo de Slack del 09:31.',
      ownerSession: SAMPLE_SESSION,
      isSample: true,
    },
    at(now, -3),
  );
}

// ---------- salidas and reviews ----------

function seedSalidasAndReviews(repos: Repos, now: Date, tk: SampleTickets): string[] {
  // The seed may build sent, failed and held samples; nothing else can (salidasRepo.transition).
  const S = { ...repos.salidas, transition: (id: string, ev: Parameters<Repos["salidas"]["transition"]>[1], now?: Date) => repos.salidas.transition(id, ev, now, { seed: true }) };
  const { db } = repos;
  const create = (input: Omit<SalidaInput, "isSample" | "ownerSession">, min: number) =>
    S.create({ ...input, isSample: true, ownerSession: SAMPLE_SESSION }, at(now, min));
  /** Approve at `min` and get past the undo window: sending + released. */
  const approveReleased = (id: string, min: number) => {
    const s = S.get(id);
    const r = S.transition(id, { type: "approve", version: s.currentVersion }, at(now, min));
    if (r.status === "queued_until_back") S.transition(id, { type: "resume" }, at(now, min + 0.35));
    else S.transition(id, { type: "release" }, at(now, min + 0.35));
  };
  const send = (id: string, min: number, permalink: string) => {
    approveReleased(id, min);
    S.transition(id, { type: "sent", permalink }, at(now, min + 0.5));
  };
  const setChip = (turnId: string, label: string) =>
    db.prepare("UPDATE salida_turns SET chip_label = ? WHERE id = ?").run(label, turnId);

  const deployThread = slackThread("#scout-dev", "C0SAMPLE01", "1730640660.118000", "Hilo 09:31 · Matt");
  const deployContext = 'Matt Ross · hoy 09:31: "andres can you confirm the env var before 2pm? we are holding the prod deploy"';
  const a17Links: SalidaLink[] = [
    { source: "github", label: "PR #59", url: gh("scout", 59) },
    { source: "slack", label: "Slack #scout-dev", url: slackUrl("C0SAMPLE01", "1730640660.118000") },
    { source: "basecamp", label: "Basecamp · Scout", url: bcUrl(1001, 5003) },
  ];

  // 1. Pending, nine versions, two starred, a semáforo turn, learned-chip turns.
  const versions: { ask: string; body: string; chip?: string; marks?: (prev: string) => Mark[] }[] = [
    { ask: "", body: "Confirmed, SCOUT_API_URL is set on staging. Production will follow after 2pm. I'll follow up here once it's done." },
    { ask: "más corto", chip: "Más corto", body: "Confirmed, SCOUT_API_URL is set on staging. Prod after 2pm." },
    { ask: "di que lo de prod es tentativo", body: "Confirmed, SCOUT_API_URL is set on staging. Prod tentatively after 2pm." },
    { ask: "más formal", body: "Confirmed: SCOUT_API_URL is set on staging. Production will follow after 2pm, tentatively." },
    {
      ask: "Mantén «SCOUT_API_URL», «staging» y «after 2pm». Reformula «Confirmed» y «Production will follow». Quita «tentatively».",
      body: "All set: SCOUT_API_URL is set on staging. The prod deploy goes after 2pm.",
      marks: (prev) => [
        mark(prev, "SCOUT_API_URL", "keep"),
        mark(prev, "staging", "keep"),
        mark(prev, "after 2pm", "keep"),
        mark(prev, "Confirmed", "redo"),
        mark(prev, "Production will follow", "redo"),
        mark(prev, "tentatively", "drop"),
      ],
    },
    { ask: "menciona la ventana de deploy", body: "All set: SCOUT_API_URL is set on staging. The prod deploy goes in the 2pm window." },
    { ask: "más corto", chip: "Más corto", body: "SCOUT_API_URL is set on staging. Prod after 2pm." },
    { ask: "más casual", body: "Confirmed, SCOUT_API_URL is on staging. Prod after 2pm." },
    { ask: "di que le avisas al terminar", body: "Confirmed, SCOUT_API_URL is on staging. Prod after 2pm, I'll ping you here when it's live." },
  ];
  const v1 = versions[0];
  if (!v1) throw new Error("sample versions are empty");
  const many = create(
    {
      source: "slack",
      destination: deployThread,
      title: "Respuesta en el hilo de deploy",
      context: deployContext,
      body: v1.body,
      ticketId: tk.a17.id,
      links: a17Links,
      expiresAt: iso(now, 180),
    },
    -16,
  );
  const times = [-16, -14, -11, -9, -7, -5, -3, -2, -0.5];
  versions.slice(1).forEach((v, i) => {
    const t = times[i + 1] ?? -1;
    const prev = versions[i]?.body ?? "";
    const d = S.addTurn(many.id, { body: v.ask, marks: v.marks?.(prev) }, at(now, t - 0.3));
    const turn = d.turns.at(-1);
    S.addVersion(many.id, { body: v.body, author: "claude" }, at(now, t));
    if (turn && v.chip) setChip(turn.id, v.chip);
  });
  S.star(many.id, 3, true);
  S.star(many.id, 4, true);

  // 2. Pending Basecamp comment, no expiry (Hoy "Salidas · esperan tu firma").
  create(
    {
      source: "basecamp",
      destination: { kind: "basecamp_comment", project: "Freightmate", projectId: "SAMPLE_BC_1001", recordingId: "5001", recordingTitle: "Tarifa por milla", postAs: ME },
      title: "Comentario en «Tarifa por milla»",
      context: 'Dana Whitfield (cliente), ayer 16:10: "¿Pueden tenerlo para el viernes? El cliente lo pidió ayer"',
      body: "Sí, lo tenemos para el viernes. Mañana subo una vista previa.",
      links: [{ source: "basecamp", label: "Basecamp · Freightmate", url: bcUrl(1001, 5001) }],
    },
    -12,
  );

  // 3. Pending Campfire line with an expiry.
  create(
    {
      source: "basecamp",
      destination: { kind: "basecamp_campfire", project: "Bseen", projectId: "SAMPLE_BC_2001", recordingTitle: "Campfire · Bseen", postAs: ME },
      title: "Línea en el Campfire de Bseen",
      context: "Lo ven 6 personas, incluido el cliente.",
      body: "Laura, ¿puedes revisar el paso 2 del onboarding en staging hoy?",
      ticketId: tk.b14.id,
      expiresAt: iso(now, 7 * 60),
    },
    -11,
  );

  // 4. Pending with an open refine turn ("Claude reescribiendo…").
  const rewriting = create(
    {
      source: "slack",
      destination: slackThread("#freightmate-dev", "C0SAMPLE05", "1730633000.000300", "Hilo 08:40 · Matt"),
      title: "Respuesta a Matt sobre el script",
      context: 'Matt Ross · hoy 08:40: "ping me when the script is ready"',
      body: "Matt, the rate migration script is ready on the branch. Run it against staging first.",
    },
    -9,
  );
  S.addTurn(rewriting.id, { body: "más formal y di que el script es idempotente" }, at(now, -1));

  // 5. Scheduled for tomorrow 09:00.
  const scheduled = create(
    {
      source: "slack",
      destination: deployThread,
      title: "Recordatorio a Matt para el deploy de prod",
      context: deployContext,
      body: "Morning Matt, reminder: the prod deploy with SCOUT_API_URL goes today after 2pm.",
      ticketId: tk.a17.id,
    },
    -15,
  );
  const tomorrow9 = new Date(now);
  tomorrow9.setDate(tomorrow9.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  S.transition(scheduled.id, { type: "schedule", at: tomorrow9.toISOString(), version: 1 }, at(now, -4));

  // 6. Sending, inside the 20 s undo window.
  const sending = create(
    {
      source: "slack",
      destination: slackThread("#buckhub-dev", "C0SAMPLE03", "1730642280.000600", "Hilo 09:58 · Matt"),
      title: "Aviso del timeout en staging",
      context: 'Matt Ross · hoy 09:58: "is staging down for you too?"',
      body: "Raised the health check timeout to 10s on staging. I'll keep an eye on it for the next hour.",
      ticketId: tk.a21.id,
    },
    -3,
  );
  S.transition(sending.id, { type: "approve", version: 1 }, now);

  // 7-11. Sent, one per destination kind, with permalinks.
  const sentSlack = create(
    {
      source: "slack",
      destination: slackThread("#buckhub-dev", "C0SAMPLE03", "1730642280.000600", "Hilo 09:58 · Matt"),
      title: "Respuesta a Matt sobre staging",
      context: 'Matt Ross · hoy 09:58: "is staging down for you too?"',
      body: "Staging is back, the 502 was the health check timeout.",
      ticketId: tk.a21.id,
    },
    -36,
  );
  send(sentSlack.id, -32, `${slackUrl("C0SAMPLE03", "1730645040.221909")}?thread_ts=1730642280.000600`);

  const sentComment = create(
    {
      source: "basecamp",
      destination: { kind: "basecamp_comment", project: "Scout", projectId: "SAMPLE_BC_1001", recordingId: "5003", recordingTitle: "Reporte semanal", postAs: ME },
      title: "Comentario en «Reporte semanal»",
      body: "Lo dejamos listo el lunes en el correo de las 8.",
    },
    -86,
  );
  send(sentComment.id, -82, `${bcUrl(1001, 5003)}#__recording_9001`);

  const sentCampfire = create(
    {
      source: "basecamp",
      destination: { kind: "basecamp_campfire", project: "Bseen", projectId: "SAMPLE_BC_2001", recordingTitle: "Campfire · Bseen", postAs: ME },
      title: "Línea en el Campfire de Bseen",
      body: "Listo: la demo queda el jueves a las 10:00.",
    },
    -48,
  );
  send(sentCampfire.id, -44, `${bcUrl(2001, 3001)}#__recording_9002`);

  const sentGhComment = create(
    {
      source: "github",
      destination: { kind: "github_comment", repo: "example-org/scout", pr: 59, path: ".env.staging", line: 12, commitId: "5a9e0c1", postAs: "acorrea-designli" },
      title: "Comentario en example-org/scout#59",
      body: "Adds the var to the staging env file; prod stays untouched until after 2pm.",
      ticketId: tk.a17.id,
      links: [{ source: "github", label: "PR #59", url: gh("scout", 59) }],
    },
    -66,
  );
  send(sentGhComment.id, -62, `${gh("scout", 59)}#discussion_r1000001`);

  // 12. Sent, then deleted (Basecamp trash, restorable).
  const deleted = create(
    {
      source: "basecamp",
      destination: { kind: "basecamp_comment", project: "Freightmate", projectId: "SAMPLE_BC_1001", recordingId: "5004", recordingTitle: "Maqueta de facturas", postAs: ME },
      title: "Comentario en «Maqueta de facturas»",
      body: "Dana, la vista previa de facturas queda para el lunes.",
    },
    -74,
  );
  send(deleted.id, -70, `${bcUrl(1001, 5004)}#__recording_9003`);
  S.transition(deleted.id, { type: "request_delete" }, at(now, -66));
  S.transition(deleted.id, { type: "deleted" }, at(now, -65));

  // 13. Failed.
  const failed = create(
    { source: "slack", destination: deployThread, title: "Respuesta en el hilo de deploy", context: deployContext, body: "Confirmed, SCOUT_API_URL is set on staging. Prod tentatively after 2pm." },
    -42,
  );
  approveReleased(failed.id, -40);
  S.transition(failed.id, { type: "failed", error: "Slack respondió not_in_channel: tu usuario no está en #scout-dev. Únete al canal o cambia el destino." }, at(now, -39.5));

  // 14. Denied.
  const denied = create(
    {
      source: "slack",
      destination: { kind: "slack_channel", workspace: WORKSPACE, channel: "#bseen-client", channelId: "C0SAMPLE04", postAs: ME },
      title: "Novedades del onboarding",
      body: "Hi team! Quick update on the onboarding: step 2 is on staging and QA starts today.",
    },
    -100,
  );
  S.transition(denied.id, { type: "deny" }, at(now, -97));

  // 15. Expired (never sent).
  const expired = create(
    {
      source: "slack",
      destination: deployThread,
      title: "Respuesta en el hilo de deploy",
      context: 'Matt 13:52: "ok we\'ll do prod tomorrow morning instead"',
      body: "Confirmed, SCOUT_API_URL is set on staging. Prod tentatively after 2pm.",
      expiresAt: iso(now, -60),
    },
    -300,
  );
  S.transition(expired.id, { type: "expire" }, now);

  // 16. Queued until the source is back ("Aprobar al volver"), via hold after release.
  const queued = create(
    {
      source: "slack",
      destination: slackThread("#scout-dev", "C0SAMPLE01", "1730641000.000700", "Hilo 09:36 · Matt"),
      title: "Respuesta en hilo de deploy",
      context: 'Matt Ross · hoy 09:36: "also, is the cron on staging?"',
      body: "Yes, the cron runs on staging every 15 min.",
    },
    -10,
  );
  approveReleased(queued.id, -8);
  S.transition(queued.id, { type: "hold", reason: "Slack no responde desde las 10:20. Sale cuando vuelva; antes se revisa el hilo." }, at(now, -7.5));

  // 17. Bounced: the thread changed before sending; back to pending with the reason.
  const bounced = create(
    {
      source: "slack",
      destination: slackThread("#bseen-client", "C0SAMPLE04", "1730560000.000200", "Hilo ayer · Dana"),
      title: "Respuesta a Dana sobre el copy",
      context: 'Dana Whitfield · ayer: "can we soften the second screen?"',
      body: "Sure, Dana. We'll soften the second screen and share it on staging tomorrow.",
    },
    -30,
  );
  approveReleased(bounced.id, -26);
  S.transition(bounced.id, { type: "bounce", reason: "El hilo cambió antes de enviar: Dana escribió 2 mensajes nuevos." }, at(now, -25));

  return seedReviews(repos, now, tk);
}

/** Reviews: one with findings in every state, one approved (empty APPROVE sent), one approving. */
function seedReviews(repos: Repos, now: Date, tk: SampleTickets): string[] {
  const { db } = repos;
  const R = repos.reviews;
  // The seed may build sent, failed and held samples; nothing else can (salidasRepo.transition).
  const S = { ...repos.salidas, transition: (id: string, ev: Parameters<Repos["salidas"]["transition"]>[1], now?: Date) => repos.salidas.transition(id, ev, now, { seed: true }) };
  const created: string[] = [];
  const flagReview = (repo: string, pr: number) =>
    db.prepare("UPDATE reviews SET is_sample = 1 WHERE repo = ? AND pr = ?").run(repo, pr);

  // Findings in every state on prospec-admin #212 (the b13 question).
  const repo212 = "example-org/prospec-admin";
  const f = (n: number, label: "blocker" | "nit" | "comment", state: "open" | "fixed" | "waived" | "dismissed", at_: string, anchor: string, summary: string, explanation: string, sha = "a1b2c3d") =>
    R.upsertFinding(tk.b13.id, { repo: repo212, pr: 212, n, label, state, at: at_, anchor, summary, explanation, sha }, at(now, -60 + n));
  f(1, "blocker", "open", "src/export/bulk.ts:88", "await Promise.all(rows.map(writeRow));", "El export no maneja errores de escritura",
    "Si una fila falla, Promise.all rechaza y el archivo queda a medias sin aviso. Usa allSettled y reporta las filas que fallaron.");
  f(2, "nit", "open", "src/export/bulk.ts:12", "const BATCH = 500;", "Mueve el tamaño de lote a la config", "Así se puede ajustar por cliente sin un deploy.");
  f(3, "blocker", "fixed", "src/export/csv.ts:40", "row.join(\",\")", "Escapar comillas y comas en el CSV", "Corregido en el último push con csvEscape().", "9f8e7d6");
  f(4, "nit", "waived", "src/export/bulk.ts:140", "function doIt(rows)", "Nombre de función poco claro", "exportRows sería más claro.");
  f(5, "comment", "dismissed", "src/api/export.ts:22", "router.get(\"/export\", handler)", "¿Hace falta paginar el endpoint?", "El export corre en background; no aplica.");
  flagReview(repo212, 212);

  // Approved: the APPROVE review with an empty body was sent.
  const repo88 = "example-org/buckhub";
  R.upsertFinding(null, { repo: repo88, pr: 88, n: 1, label: "nit", state: "fixed", at: "src/auth/refresh.ts:31", anchor: "console.log(token)", summary: "No loguees el token en el refresh", explanation: "Corregido en el último push.", sha: "c0ffee1" }, at(now, -30));
  flagReview(repo88, 88);
  const rv88 = R.byPr(repo88, 88);
  const approved = R.action(rv88.id, { action: "approve" }, at(now, -24));
  for (const id of approved.salidaIds) {
    created.push(id);
    // The press approved it; get past the undo window (or resume it if GitHub is down here).
    const queued = S.get(id).status === "queued_until_back";
    S.transition(id, queued ? { type: "resume" } : { type: "release" }, at(now, -23.6));
    S.transition(id, { type: "sent", permalink: `${gh("buckhub", 88)}#pullrequestreview-1000001` }, at(now, -23.5));
  }
  R.get(rv88.id); // follows the sent salida: approving -> approved

  // Approving: the approve salida is in its undo window (ticket a17).
  const repo59 = "example-org/scout";
  R.upsertFinding(tk.a17.id, { repo: repo59, pr: 59, n: 1, label: "comment", state: "fixed", at: ".env.staging:12", anchor: "SCOUT_API_URL=", summary: "Documenta la variable en el README", explanation: "Añadida en el último push.", sha: "5a9e0c1" }, at(now, -50));
  flagReview(repo59, 59);
  const approving = R.action(R.byPr(repo59, 59).id, { action: "approve" }, now);
  created.push(...approving.salidaIds);

  return created;
}

// ---------- approvals ----------

function seedApprovals(repos: Repos, now: Date, tk: SampleTickets): string[] {
  const A = repos.approvals;
  const { db } = repos;
  const ids: string[] = [];
  const cwd = (p: string) => `G:/WorkSpace/designli/${p}`;

  // Pending on a ticket (shown in the ticket and the rail).
  ids.push(
    A.create(
      {
        ticketRef: tk.a17.ref,
        agent: `writer-${tk.a17.ref}`,
        tool: "Bash",
        summary: "Correr el smoke test de staging en scout-api",
        detail: "pnpm --filter scout-api smoke --env staging",
        cwd: cwd("scout"),
        hints: ["Bash(pnpm --filter scout-api smoke:*)", "Bash(pnpm --filter scout-api test:*)"],
        expiresAt: iso(now, 50),
      },
      at(now, -1),
    ).id,
  );
  // Pending without a ticket (shown on Hoy).
  ids.push(
    A.create(
      {
        agent: "lead",
        tool: "Write",
        summary: "Crear .claude/settings.local.json en designli/buckhub",
        detail: '+ {\n+   "permissions": { "allow": ["Bash(pnpm test:*)"] }\n+ }',
        cwd: cwd("buckhub"),
        hints: ["Write(.claude/settings.local.json)"],
        expiresAt: iso(now, 45),
      },
      at(now, -2),
    ).id,
  );
  // Decided: allow, read_config, deny.
  const decided = (
    i: { ticketRef?: string; agent: string; tool: string; summary: string; detail: string; cwd: string },
    min: number,
    decision: "allow" | "read_config" | "deny",
    note: string,
  ) => {
    const a = A.create({ ...i, expiresAt: iso(now, min + 9) }, at(now, min));
    A.decide(a.id, { decision, actor: "andres", note }, at(now, min + 1), { seed: true });
    ids.push(a.id);
  };
  decided(
    { ticketRef: tk.a21.ref, agent: `investigator-${tk.a21.ref}`, tool: "Bash", summary: "Leer los logs de staging de buckhub", detail: "kubectl logs deploy/buckhub-api -n staging --since=2h", cwd: cwd("buckhub") },
    -108,
    "allow",
    "",
  );
  decided(
    { ticketRef: tk.b13.ref, agent: `reviewer-${tk.b13.ref}`, tool: "Read", summary: "Leer .env.local de prospec-admin", detail: "G:/WorkSpace/designli/prospec-admin/.env.local", cwd: cwd("prospec-admin") },
    -58,
    "read_config",
    "Usa .env.example; el .env.local tiene secretos.",
  );
  decided(
    { agent: "lead", tool: "Bash", summary: "git push --force a main en scout", detail: "git push --force origin main", cwd: cwd("scout") },
    -76,
    "deny",
    "Nunca a main. Abre un PR.",
  );
  // Expired: nobody decided in time.
  const exp = A.create(
    { agent: `investigator-${tk.a21.ref}`, ticketRef: tk.a21.ref, tool: "WebFetch", summary: "Abrir el dashboard de Vercel de buckhub", detail: "https://vercel.example.com/example-org/buckhub", cwd: cwd("buckhub"), expiresAt: iso(now, -31) },
    at(now, -40),
  );
  db.prepare("UPDATE approvals SET status = 'expired' WHERE id = ?").run(exp.id);
  ids.push(exp.id);
  return ids;
}

// ---------- briefs, team, handoffs ----------

function seedAgents(repos: Repos, now: Date, tk: SampleTickets): void {
  const G = repos.agents;
  const a17 = tk.a17.ref;
  const a21 = tk.a21.ref;
  const a19 = tk.a19.ref;
  const b13 = tk.b13.ref;
  const a16 = tk.a16.ref;

  // Team: live and retired agents.
  G.addAgent({ ticket: a17, name: `investigator-${a17}`, role: "investigator" }, at(now, -110));
  G.addAgent({ ticket: a17, name: `writer-${a17}`, role: "writer", owner: true }, at(now, -60));
  G.retireAgent(`investigator-${a17}`, at(now, -61));
  G.addAgent({ ticket: a21, name: `investigator-${a21}`, role: "investigator", owner: true }, at(now, -110));
  G.addAgent({ ticket: a19, name: `summarizer-${a19}`, role: "summarizer", owner: true }, at(now, -88));
  G.addAgent({ ticket: b13, name: `reviewer-${b13}`, role: "reviewer", owner: true }, at(now, -64));
  G.addAgent({ ticket: a16, name: `analyst-${a16}`, role: "analyst", owner: true }, at(now, -170));
  G.retireAgent(`analyst-${a16}`, at(now, -131));

  // Handoffs: done, paused, blocked.
  G.addHandoff(
    a17,
    {
      agent: `investigator-${a17}`,
      status: "done",
      body: "Encontré la causa en los logs de staging y abrí el PR #59.",
      done: "Leí los logs de scout-api; SCOUT_API_URL faltaba en staging. Abrí PR #59 con la variable.",
      remaining: "Confirmar a Matt en el hilo de deploy antes de las 2pm (salida en Salidas).",
      artifacts: { branch: "chore/scout-api-url-staging", pr: gh("scout", 59), files: [".env.staging"] },
    },
    at(now, -61),
  );
  G.addHandoff(
    a21,
    {
      agent: `investigator-${a21}`,
      status: "paused",
      body: "Subí el timeout del health check a 10 s; espero una hora de tráfico para confirmar.",
      done: "Causa: el health check tarda 6 s en frío y el balanceador corta a los 5 s.",
      remaining: "Mirar los 502 de la próxima hora y avisarle a Matt.",
      artifacts: { branch: "fix/healthcheck-timeout", files: ["infra/staging/lb.yaml"] },
    },
    at(now, -90),
  );
  G.addHandoff(
    a19,
    {
      agent: `summarizer-${a19}`,
      status: "blocked",
      body: "No puedo leer #buckhub-design: la sesión no está en el canal.",
      done: "Resumí #buckhub-dev y los mensajes de Basecamp de la semana.",
      remaining: "Falta #buckhub-design. Necesito que me inviten o que lo saque del resumen.",
    },
    at(now, -70),
  );
  G.addHandoff(
    a16,
    {
      agent: `analyst-${a16}`,
      status: "done",
      body: "Comparé la tabla nueva con el cálculo actual; no hay que tocar código.",
      done: "Resumen en el ticket.",
      remaining: "",
    },
    at(now, -131),
  );

  // Briefs.
  G.putBrief(
    a17,
    {
      body: "Scout necesita SCOUT_API_URL en staging antes del deploy de prod de las 2pm. PR #59 la añade; Matt ya redesplegó staging.",
      goal: "Confirmarle a Matt que la variable está bien en staging antes de las 2pm.",
      decisions: ["Prod no se toca hasta después de las 2pm", "Nombrar la env var exacta, nunca su valor"],
      planStep: "Respuesta en el hilo de deploy esperando tu firma",
      openQuestions: [],
      nextAction: "Cuando firmes, enviar la respuesta al hilo de Matt",
      updatedBy: `writer-${a17}`,
    },
    at(now, -10),
  );
  G.putBrief(
    a21,
    {
      body: "Staging de buckhub daba 502 por el timeout del health check.",
      goal: "Que staging deje de dar 502.",
      decisions: ["Subir el timeout del health check a 10 s"],
      planStep: "Observando el tráfico una hora",
      openQuestions: ["¿Lo llevamos también a prod?"],
      nextAction: "Avisarle a Matt cuando pase la hora sin 502",
      updatedBy: `investigator-${a21}`,
    },
    at(now, -90),
  );
  G.putBrief(
    b13,
    {
      body: "Review del export masivo de prospec-admin: 1 blocker y 1 nit abiertos.",
      goal: "Decidir si se piden tests antes de aprobar.",
      decisions: [],
      planStep: "Esperando tu elección A o B",
      openQuestions: ["¿Pedir tests del export o aprobar?"],
      nextAction: "Publicar los hallazgos o aprobar según tu respuesta",
      updatedBy: `reviewer-${b13}`,
    },
    at(now, -60),
  );
}

// ---------- engram and chips ----------

function seedEngram(repos: Repos, now: Date, tk: SampleTickets): string[] {
  const E = repos.engram;
  return [
    E.link({ entityType: "ticket", entityId: tk.a17.id, project: "scout", topicKey: `mesa/${tk.a17.ref}`, observationId: "sample-obs-1001" }, at(now, -95)).id,
    E.link({ entityType: "ticket", entityId: tk.a17.id, project: "scout", topicKey: `mesa/${tk.a17.ref}`, observationId: "sample-obs-1002" }, at(now, -60)).id,
    E.link({ entityType: "ticket", entityId: tk.b14.id, project: "bseen", topicKey: `mesa/${tk.b14.ref}`, observationId: "sample-obs-1003" }, at(now, -36)).id,
    E.link({ entityType: "ticket", entityId: tk.b12.id, project: "freightmate", topicKey: `mesa/${tk.b12.ref}`, observationId: "sample-obs-1004" }, at(now, -149)).id,
  ];
}

/** Learned chips as in the mocks. A label that already exists as a real chip is left alone. */
function seedChips(db: Db, now: Date): void {
  const chips: [string, string[], number, number][] = [
    ["Más corto", ["acórtalo", "menos texto, porfa"], 7, -3],
    ["Sin saludo", ["quita el hola", "sin el saludo"], 4, -50],
    ["Menciona el ticket", ["pon el a17", "referencia el ticket"], 3, -120],
    ["En inglés", ["pásalo a inglés", "in english please"], 2, -26 * 60],
  ];
  for (const [label, phrasings, uses, min] of chips) {
    db.prepare(
      "INSERT OR IGNORE INTO learned_chips (label, phrasings, uses, last_used_at, is_sample) VALUES (?, ?, ?, ?, 1)",
    ).run(label, JSON.stringify(phrasings), uses, iso(now, min));
  }
}
