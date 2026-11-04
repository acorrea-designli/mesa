// Lane B dev seed: fills a running Mesa (default http://127.0.0.1:8792) with labelled
// sample tickets, salidas, approvals and a review through the public API, so every
// Tickets A and Salidas B state is reachable. Use it only on a throwaway database
// (MESA_DB=data/lane-b.db). Lane C's `pnpm seed` replaces it.
//   node src/features/salidas/dev/seed.mjs [baseUrl]
const BASE = process.argv[2] ?? process.env.MESA_URL ?? "http://127.0.0.1:8792";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inMs = (ms) => new Date(Date.now() + ms).toISOString();

async function api(path, body, method) {
  const res = await fetch(BASE + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method ?? "POST"} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const tr = (id, ev) => api(`/api/salidas/${id}/transition`, ev);
const version = (id, body, chipLabel) => api(`/api/salidas/${id}/versions`, { body, author: "claude", chipLabel });
const turn = (id, t) => api(`/api/salidas/${id}/turns`, t);

const SLACK = { workspace: "designli.slack.com", postAs: "Andrés Correa" };
const thread = (channel, threadLabel) => ({ kind: "slack_thread", channel, threadTs: "1730640660.118", threadLabel, ...SLACK });

async function main() {
  await api("/api/sessions", { id: "lead", label: "lead (muestra)", cwd: "G:/WorkSpace/designli", project: "designli" });

  // ---------------- tickets ----------------
  const tA = await api("/api/tickets", {
    direction: "claude_asks",
    title: "¿Cierro el to-do de Bseen o espero QA?",
    project: "bseen",
    ownerSession: "lead",
    isSample: true,
    body: "El to-do «Ajustar onboarding, paso 2» ya está en staging. Laura (QA) aún no lo revisa.",
    options: [
      { key: "A", label: "Cerrar el to-do ahora", detail: "El cliente lo ve como hecho hoy" },
      { key: "B", label: "Esperar a QA", detail: "Y recordarle a Laura mañana 09:00" },
    ],
    recommended: "B",
    recommendation: "el cliente pidió ver QA antes de cerrar (mensaje del 28 oct).",
    refs: [{ refType: "url", target: "https://3.basecamp.com/0000000/buckets/1/todos/1", label: "Basecamp · Bseen · To-do" }],
  });
  await api("/api/engram/links", { entityType: "ticket", entityId: tA.id, project: "bseen", topicKey: `mesa/${tA.ref}` });

  const tB = await api("/api/tickets", {
    direction: "claude_asks",
    title: "¿Le contesto a Matt por escrito o pido llamada?",
    project: "scout",
    ownerSession: "lead",
    isSample: true,
    body: "Matt pregunta en #scout-dev por la ventana de deploy. Hay dos caminos.",
    options: [
      { key: "A", label: "Contestar por escrito", detail: "Un mensaje corto en el hilo" },
      { key: "B", label: "Pedir una llamada", detail: "15 min hoy antes de las 2pm" },
    ],
    recommended: "A",
    recommendation: "Matt confirma por escrito, no por llamada (decisión en engram).",
  });

  const tReview = await api("/api/tickets", {
    direction: "claude_asks",
    title: "PR #212: ¿pido tests del export o apruebo?",
    project: "prospec-admin",
    ownerSession: "lead",
    isSample: true,
    body: "El monitor revisó el PR #212 (export CSV). Hay un bloqueante y una sugerencia.",
  });

  const tPlan = await api("/api/tickets", {
    direction: "andres_asks",
    title: "Cancela la respuesta a Matt y mueve el export de prospec a Esperando",
    project: "buckhub",
    ownerSession: "lead",
    isSample: true,
    body: "Cancela la respuesta a Matt, mueve el export de prospec a Esperando y crea una tarea para revisar el lockfile de buckhub con el log adjunto.",
    refs: [{ refType: "ticket", target: tReview.ref, label: "PR #212 export" }],
  });
  await api(`/api/tickets/${tPlan.id}/plan`, {
    session: "lead",
    actions: [
      { kind: "cancel_salida", source: "slack", label: "Cancelar salida · respuesta a Matt", mode: "direct", target: { detail: "Slack #scout-dev · hilo de deploy · aún no enviada" } },
      { kind: "move_card", source: "github", label: "Mover en el tablero · Export CSV", mode: "direct", target: { detail: "prospec-admin · En curso → Esperando" } },
      { kind: "create_task", source: "claude", label: "Crear tarea · Revisar lockfile de buckhub", mode: "direct", target: { detail: "Todo · con build-main-1103.log" } },
      { kind: "write_client", source: "basecamp", label: "Escribir al cliente si el lockfile es la causa", mode: "needs_ok", target: { detail: "Basecamp · Buckhub · pasa por Salidas" } },
    ],
  });
  await api(`/api/tickets/${tPlan.ref}/brief`, {
    goal: "Desbloquear el deploy de buckhub sin escribirle al cliente antes de tiempo",
    planStep: "2 de 4 · moviendo la tarjeta del export",
    nextAction: "Crear la tarea del lockfile con el log adjunto",
    openQuestions: ["¿Escribo al cliente si el lockfile es la causa?"],
    decisions: ["La respuesta a Matt no sale hasta tener el log"],
    updatedBy: "dev-" + tPlan.ref,
  }, "PUT");
  await api("/api/team", { ticketRef: tPlan.ref, agent: `lead-${tPlan.ref}`, role: "lead", owner: true });
  await api("/api/team", { ticketRef: tPlan.ref, agent: `dev-${tPlan.ref}`, role: "dev" });
  await api("/api/team", { ticketRef: tPlan.ref, agent: `research-${tPlan.ref}`, role: "research" });
  await api(`/api/team/research-${tPlan.ref}/retire`, {});
  await api(`/api/tickets/${tPlan.ref}/handoffs`, { agent: `research-${tPlan.ref}`, role: "research", status: "done", body: "Leí el log: el lockfile pide next 15 y el CI usa 14.", done: "Causa probable identificada", remaining: "Confirmar con un build limpio" });
  await api(`/api/tickets/${tPlan.ref}/handoffs`, { agent: `dev-${tPlan.ref}`, role: "dev", status: "paused", body: "Espero tu OK del plan para escribir al cliente.", done: "Tarjeta movida", remaining: "Tarea del lockfile", artifacts: { branch: "fix/lockfile" } });
  await api(`/api/tickets/${tPlan.id}/messages`, { author: "claude", body: "Tengo el plan listo. Lo que escribe al cliente te pide OK.", session: "lead" }).catch(() => {});

  const tWorking = await api("/api/tickets", {
    direction: "andres_asks",
    title: "Resume los hilos de Buckhub de la semana",
    project: "buckhub",
    ownerSession: "lead",
    isSample: true,
    body: "Resume los hilos de Buckhub de esta semana y dime qué espera el cliente de nosotros.",
  });
  await api(`/api/tickets/${tWorking.id}/transition`, { event: "claim", session: "lead" });

  const tAnswered = await api("/api/tickets", {
    direction: "claude_asks",
    title: "¿Uso la plantilla vieja de factura?",
    project: "freightmate",
    ownerSession: "lead",
    isSample: true,
    body: "Freightmate pidió la factura de octubre. La plantilla nueva aún no tiene su logo.",
    options: [
      { key: "A", label: "Plantilla vieja", detail: "Sale hoy, con el logo correcto" },
      { key: "B", label: "Esperar la nueva", detail: "Sale el lunes" },
    ],
    recommended: "A",
    recommendation: "el cliente necesita la factura antes del cierre de mes.",
  });
  await api(`/api/tickets/${tAnswered.id}/messages`, { author: "andres", body: "A. Y avísame cuando salga.", chosen: "A" });

  const tClosed = await api("/api/tickets", {
    direction: "andres_asks",
    title: "Revisa las tarifas nuevas de Freightmate",
    project: "freightmate",
    ownerSession: "lead",
    isSample: true,
    body: "Revisa las tarifas nuevas que mandó Dana y dime si cambian algo del export.",
  });
  await api(`/api/tickets/${tClosed.id}/messages`, { author: "claude", body: "Listo: las tarifas nuevas solo cambian la columna de millas; el export no se toca.", session: "lead" });
  await api(`/api/tickets/${tClosed.id}/transition`, { event: "close", by: "andres" });
  await api("/api/engram/links", { entityType: "ticket", entityId: tClosed.id, project: "freightmate", topicKey: `mesa/${tClosed.ref}` });

  const tOrigin = await api("/api/tickets", {
    direction: "andres_asks",
    title: "Revisar la env var de Scout antes del deploy",
    project: "scout",
    ownerSession: "lead",
    isSample: true,
    body: "Revisa que SCOUT_API_URL esté bien en staging antes de que Matt despliegue.",
  });
  await api(`/api/tickets/${tOrigin.id}/messages`, { author: "claude", body: "Leí los logs de staging: 09:04:51 scout-api WARN SCOUT_API_URL missing, falling back to http://localhost:4000", session: "lead" });
  await api(`/api/tickets/${tOrigin.ref}/handoffs`, { agent: `dev-${tOrigin.ref}`, role: "dev", status: "done", body: "PR abierto: chore: add SCOUT_API_URL to staging", done: "Variable añadida en staging", artifacts: { pr: "https://github.com/muestra/scout/pull/59" } });
  await api(`/api/tickets/${tOrigin.id}/messages`, { author: "claude", body: "Verifiqué staging: GET /health 200 · SCOUT_API_URL presente. Te dejo la respuesta para Matt en Salidas.", session: "lead" });
  await api("/api/engram/links", { entityType: "ticket", entityId: tOrigin.id, project: "scout", topicKey: `mesa/${tOrigin.ref}` });

  // ---------------- approvals ----------------
  await api("/api/approvals", {
    ticketRef: tReview.ref,
    agent: `review-${tReview.ref}`,
    tool: "Bash",
    summary: "Correr los tests del export",
    detail: "pnpm --filter prospec-admin test -- export.csv.test.ts",
    cwd: "G:/WorkSpace/designli/prospec-admin",
    hints: ["Bash(pnpm test:*)", "Bash(pnpm --filter * lint)"],
  });
  await api("/api/approvals", {
    ticketRef: tReview.ref,
    agent: `review-${tReview.ref}`,
    tool: "Edit",
    summary: "src/export/csv.ts",
    detail: "@@ -41,7 +41,9 @@\n-  const rows = data.map(toRow)\n+  const rows = data\n+    .filter((r) => r.active)\n+    .map(toRow)",
    cwd: "G:/WorkSpace/designli/prospec-admin",
    hints: ["Edit(src/**)"],
  });
  await api("/api/approvals", { ticketRef: tReview.ref, agent: `review-${tReview.ref}`, tool: "Bash", summary: "git push origin fix/export", detail: "git push origin fix/export", hints: [], expiresAt: inMs(2500) });
  const decided = await api("/api/approvals", { ticketRef: tPlan.ref, agent: `dev-${tPlan.ref}`, tool: "Bash", summary: "Leer el log del build", detail: "cat build-main-1103.log", hints: ["Bash(cat *)"] });
  await api(`/api/approvals/${decided.approval.id}/approve`, {});
  await api("/api/approvals", { agent: "sweep-hoy", tool: "Bash", summary: "Listar PRs pendientes", detail: "gh search prs --review-requested=@me --state=open", hints: ["Bash(gh pr list:*)"] });

  // ---------------- review ----------------
  const R = { repo: "muestra/prospec-admin", pr: 212, sha: "a1b2c3d" };
  await api(`/api/tickets/${tReview.ref}/findings`, { ...R, n: 1, label: "blocker", at: "src/export/csv.ts:42", anchor: "const rows = data.map(toRow)", summary: "El export incluye filas inactivas.", explanation: "toRow recibe todo `data`; las cuentas archivadas aparecen en el CSV del cliente." });
  await api(`/api/tickets/${tReview.ref}/findings`, { ...R, n: 2, label: "nit", at: "src/export/csv.ts:57", summary: "El nombre `tmp` no dice qué guarda.", explanation: "Sugerencia: `header`." });
  await api(`/api/tickets/${tReview.ref}/findings`, { ...R, n: 3, label: "comment", at: "src/export/index.ts:12", summary: "Faltan tests del export.", explanation: "No hay test para el caso vacío." });
  await api(`/api/tickets/${tReview.ref}/findings`, { ...R, n: 4, label: "nit", at: "src/export/csv.ts:9", summary: "Import sin usar.", state: "fixed" });
  await api(`/api/tickets/${tReview.ref}/findings`, { ...R, n: 5, label: "comment", at: "README.md:3", summary: "Typo en el README.", state: "dismissed" });

  // ---------------- salidas ----------------
  const links = [
    { source: "github", label: "PR #59", url: "https://github.com/muestra/scout/pull/59" },
    { source: "slack", label: "Slack #scout-dev" },
    { source: "basecamp", label: "Basecamp · Scout" },
  ];
  const s1 = await api("/api/salidas", {
    source: "slack",
    destination: thread("#scout-dev", "Matt Ross · hoy 09:31"),
    title: "Respuesta en el hilo de deploy",
    context: "Matt: \"andres can you confirm the env var before 2pm? we are holding the prod deploy\"",
    ticketId: tOrigin.id,
    links,
    ownerSession: "lead",
    expiresAt: inMs(4 * 3600_000),
    isSample: true,
    body: "Hi Matt! Confirmed, SCOUT_API_URL is set on staging and the health check is green. Prod can go after 2pm. I'll follow up if anything changes.",
  });
  await turn(s1.id, { body: "más corto" });
  await version(s1.id, "Confirmed, SCOUT_API_URL is set on staging. Prod after 2pm.", "Más corto");
  await turn(s1.id, { body: "di que lo de prod es tentativo" });
  await version(s1.id, "Confirmed, SCOUT_API_URL is set on staging. Prod tentatively after 2pm.", "Prod tentativo");

  const s2 = await api("/api/salidas", {
    source: "basecamp",
    destination: { kind: "basecamp_comment", project: "Freightmate", recordingId: "88120", recordingTitle: "Tarifa por milla", postAs: "Andrés Correa" },
    title: "Comentario en «Tarifa por milla»",
    context: "Dana Whitfield (cliente), ayer 16:10: \"Will the per-mile rate be ready by Friday?\"",
    ticketId: tClosed.id,
    ownerSession: "lead",
    isSample: true,
    body: "Sí, lo tenemos para el viernes. Mañana subo una vista previa.",
  });
  const s3 = await api("/api/salidas", {
    source: "basecamp",
    destination: { kind: "basecamp_campfire", project: "Bseen", recordingTitle: "Campfire · Bseen", postAs: "Andrés Correa" },
    title: "Línea en el Campfire de Bseen",
    ticketId: tA.id,
    ownerSession: "lead",
    expiresAt: inMs(7 * 3600_000),
    isSample: true,
    body: "Laura, ¿puedes revisar el paso 2 del onboarding en staging hoy?",
  });

  // Many versions, one starred, a marked turn answered.
  const s4 = await api("/api/salidas", {
    source: "slack",
    destination: thread("#buckhub-dev", "Matt Ross · hoy 09:05"),
    title: "Ventana de deploy de Buckhub",
    ticketId: tWorking.id,
    ownerSession: "lead",
    isSample: true,
    body: "Hey Matt, the lockfile is fixed on main. Prod can go after 2pm.",
  });
  const asks = [
    ["acórtalo", "Lockfile fixed on main. Prod after 2pm.", "Más corto"],
    ["más formal", "Confirmed: the lockfile is fixed on main. Production will follow after 2pm, tentatively.", "Más formal"],
    ["quita el hola", "Lockfile is fixed on main. Prod after 2pm, tentatively.", "Sin saludo"],
    ["menciona la ventana de deploy", "Lockfile is fixed on main. Prod in the 2pm deploy window.", "Ventana de deploy"],
    ["menos texto, porfa", "Lockfile fixed. Prod at 2pm.", "Más corto"],
    ["más casual", "Lockfile's fixed on main, prod goes at 2pm.", "Más casual"],
    ["sin el saludo", "Lockfile is fixed on main. Prod after 2pm.", "Sin saludo"],
    ["di que le avisas al terminar", "Lockfile is fixed on main. Prod after 2pm, I'll ping you here when it's live.", "Avísale al terminar"],
  ];
  for (const [ask, body, chip] of asks) {
    await turn(s4.id, { body: ask });
    await version(s4.id, body, chip);
  }
  await api(`/api/salidas/${s4.id}/versions/3`, { starred: true }, "PATCH");
  const marked = "Lockfile is fixed on main. Prod after 2pm, I'll ping you here when it's live.";
  const mk = (text, kind) => ({ start: marked.indexOf(text), end: marked.indexOf(text) + text.length, kind, text });
  await turn(s4.id, { body: "", marks: [mk("Lockfile", "keep"), mk("fixed on main", "keep"), mk("Prod", "redo"), mk("I'll ping you here when it's live", "drop")] });
  await version(s4.id, "Lockfile is fixed on main. The prod deploy goes after 2pm.");

  // Rewrite pending.
  const s5 = await api("/api/salidas", {
    source: "slack",
    destination: { kind: "slack_channel", channel: "#scout-dev", ...SLACK },
    title: "Aviso de deploy en #scout-dev",
    ticketId: tB.id,
    ownerSession: "lead",
    isSample: true,
    body: "Deploy de staging listo. Prod a las 2pm si nadie objeta.",
  });
  await turn(s5.id, { body: "en inglés", chipLabel: "En inglés" });

  // Scheduled.
  const s6 = await api("/api/salidas", {
    source: "basecamp",
    destination: { kind: "basecamp_message", project: "Buckhub", recordingTitle: "Resumen semanal", postAs: "Andrés Correa" },
    title: "Resumen semanal para Buckhub",
    ticketId: tWorking.id,
    ownerSession: "lead",
    isSample: true,
    body: "Resumen de la semana: lockfile corregido, export en revisión y deploy de prod el martes.",
  });
  const tomorrow9 = new Date();
  tomorrow9.setDate(tomorrow9.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  await tr(s6.id, { type: "schedule", at: tomorrow9.toISOString(), version: 1 });

  // States that need the 20 s window to end first.
  const mkSimple = (title, destination, source, body, extra = {}) =>
    api("/api/salidas", { source, destination, title, ownerSession: "lead", isSample: true, body, ...extra });
  const sSentSl = await mkSimple("Gracias en #buckhub-dev", thread("#buckhub-dev", "Matt Ross · hoy 08:40"), "slack", "Thanks Matt, merged.");
  const sSentBc = await mkSimple("Comentario en «Paso 2 del onboarding»", { kind: "basecamp_comment", project: "Bseen", recordingTitle: "Paso 2 del onboarding", postAs: "Andrés Correa" }, "basecamp", "Listo en staging, Laura lo revisa hoy.");
  const sSentCf = await mkSimple("Línea en el Campfire de Freightmate", { kind: "basecamp_campfire", project: "Freightmate", postAs: "Andrés Correa" }, "basecamp", "Subí la vista previa de tarifas.");
  const sDeleted = await mkSimple("Comentario duplicado en Bseen", { kind: "basecamp_comment", project: "Bseen", recordingTitle: "QA de onboarding", postAs: "Andrés Correa" }, "basecamp", "Laura, ¿lo revisas hoy?");
  const sFailed = await mkSimple("Respuesta en #scout-design", { kind: "slack_channel", channel: "#scout-design", ...SLACK }, "slack", "Looks good to me, ship it.");
  const sQueued = await mkSimple("Pregunta a Dana sobre el logo", { kind: "basecamp_comment", project: "Freightmate", recordingTitle: "Factura de octubre", postAs: "Andrés Correa" }, "basecamp", "Dana, ¿usamos el logo de siempre en la factura?", { ticketId: tAnswered.id });
  const sDenied = await mkSimple("Respuesta a Matt en #scout-dev", thread("#scout-dev", "Matt Ross · hoy 09:31"), "slack", "Confirmed, prod is set too. Deploy whenever.", { ticketId: tOrigin.id });
  const sExpired = await mkSimple("Respuesta vieja en #scout-dev", thread("#scout-dev", "Matt Ross · hoy 07:50"), "slack", "Prod tomorrow morning works.", { expiresAt: inMs(2000) });
  for (const s of [sSentSl, sSentBc, sSentCf, sDeleted, sFailed, sQueued]) await tr(s.id, { type: "approve", version: 1 });
  await tr(sDenied.id, { type: "deny" });

  // Review actions create github salidas already approved (20 s undo).
  const reviews = await api(`/api/reviews?ticket=${tReview.ref}`);
  const review = reviews.reviews[0];
  await api(`/api/reviews/${review.id}/actions`, { action: "post", findingNs: [2] });

  console.log("waiting 21 s for the undo windows to end…");
  await sleep(21_500);
  await api("/api/health");
  await tr(sSentSl.id, { type: "sent", permalink: "https://designli.slack.com/archives/C0SAMPLE/p1730645040221909?thread_ts=1730640660.118" });
  await tr(sSentBc.id, { type: "sent", permalink: "https://3.basecamp.com/0000000/buckets/1/messages/88120#__recording_91840" });
  await tr(sSentCf.id, { type: "sent", permalink: "https://3.basecamp.com/0000000/buckets/2/chats/55021@91873" });
  await tr(sDeleted.id, { type: "sent", permalink: "https://3.basecamp.com/0000000/buckets/1/messages/88121" });
  await tr(sDeleted.id, { type: "request_delete" });
  await tr(sDeleted.id, { type: "deleted" });
  await tr(sFailed.id, { type: "failed", error: "Slack respondió not_in_channel: tu usuario no está en #scout-design. Únete al canal o cambia el destino." });
  await tr(sQueued.id, { type: "hold", reason: "Basecamp no responde (502) desde las 10:40." });

  // A thread-changed bounce: pending again with its reason.
  const sBounce = await mkSimple("Confirmación a Dana", { kind: "basecamp_comment", project: "Freightmate", recordingTitle: "Tarifa por milla", postAs: "Andrés Correa" }, "basecamp", "Perfecto, lo dejamos así.");
  await tr(sBounce.id, { type: "approve", version: 1 });
  console.log("waiting 21 s for the bounce sample…");
  await sleep(21_500);
  await api("/api/health");
  await tr(sBounce.id, { type: "bounce", reason: "El hilo tuvo 2 mensajes nuevos desde que la firmaste" });

  console.log("seeded", { tickets: [tA.ref, tB.ref, tReview.ref, tPlan.ref, tWorking.ref, tAnswered.ref, tClosed.ref, tOrigin.ref], salidas: [s1.id, s2.id, s3.id, s4.id, s5.id, s6.id, sExpired.id] });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
