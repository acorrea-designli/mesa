#!/usr/bin/env node
// Lane A dev seed: fills a dev server with the mock's sample data through the REST API
// (every row isSample, shown with "Datos de muestra."). Temporary until lane C's
// `pnpm seed` lands. Point it at a throwaway database, never data/mesa.db:
//   MESA_DB=data/lane-a.db pnpm exec next dev --hostname 127.0.0.1 --port 8791
//   node src/features/hoy/dev/seed.mjs [--url http://127.0.0.1:8791] [--scenario full|calm|slack-down|github-paused]
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const URL_BASE = opt("url", process.env.MESA_URL ?? "http://127.0.0.1:8791");
const SCENARIO = opt("scenario", "full");

async function api(method, path, body) {
  const res = await fetch(URL_BASE + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const today = (hhmm, daysAgo = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const S = { isSample: true };
const items = {};
async function item(key, input) {
  const { item: it } = await api("POST", "/api/items/upsert", { ...S, ...input, externalId: `sample:${key}` });
  items[key] = it;
  return it;
}

async function seedItems() {
  // Inbox
  await item("fm-tarifa", { source: "basecamp", kind: "request", title: "cambio en tarifa por milla", project: "Freightmate", excerpt: "“¿Pueden tenerlo para el viernes? El cliente lo pidió ayer”", need: "reply", waitOn: "you", receivedAt: today("08:15"), url: "https://3.basecamp.com/" });
  await item("pr212", { source: "github", kind: "pr_review", title: "#212 · feat: bulk export", project: "prospec-admin", excerpt: "Review solicitado · +418 −36 · monitor: 2 hallazgos", need: "approve_pr", waitOn: "you", receivedAt: today("09:02"), url: "https://github.com/", meta: { pr: 212 } });
  await item("pr212-bc", { source: "basecamp", kind: "request", title: "export masivo pedido por el cliente", project: "Prospec", excerpt: "“Necesitamos exportar todo el pipeline”", need: "reply", waitOn: "you", receivedAt: today("09:00"), url: "https://3.basecamp.com/" });
  await item("scout-deploy", { source: "slack", kind: "mention", title: "hilo de deploy", project: "#scout-dev", excerpt: "Matt: “andres can you confirm the env var before 2pm?”", need: "reply", waitOn: "you", receivedAt: today("09:31"), url: "https://slack.com/", meta: { channel: "#scout-dev" } });
  await item("b14", { source: "claude", kind: "question", title: "¿Cierro el to-do de Bseen o espero QA?", project: "bseen", excerpt: "Ticket b14 · Claude pregunta", need: "decision", waitOn: "you", receivedAt: today("10:05"), meta: { ticketRef: "b14" } });
  await item("pr88", { source: "github", kind: "pr_review", title: "#88 · fix: token refresh", project: "buckhub", excerpt: "Monitor: sin hallazgos · listo para aprobar", need: "approve_pr", waitOn: "you", tag: "clean", receivedAt: today("10:20"), url: "https://github.com/" });
  await item("pr341", { source: "github", kind: "pr_review", title: "#341 · chore: bump prisma to 6.2", project: "freightmate-api", excerpt: "Review solicitado · +88 −71", need: "approve_pr", waitOn: "you", receivedAt: today("09:48"), url: "https://github.com/" });
  await item("bseen-copy", { source: "slack", kind: "message", title: "suavizar el copy del onboarding", project: "#bseen-client", excerpt: "Cliente: “can we soften the second screen?”", need: "reply", waitOn: "you", receivedAt: today("17:40", 1), url: "https://slack.com/", meta: { channel: "#bseen-client" } });
  await item("scout-pdf", { source: "basecamp", kind: "todo", title: "exportar reporte semanal a PDF", project: "Scout", excerpt: "“The client wants it in the Monday email”", need: "reply", waitOn: "you", receivedAt: today("11:00", 1), url: "https://3.basecamp.com/" });

  // Todo
  await item("a19", { source: "claude", kind: "question", title: "Resumir los hilos de Buckhub de la semana", project: "buckhub", excerpt: "Pediste · ticket a19", need: "decision", station: "todo", waitOn: "claude", receivedAt: today("09:12"), meta: { ticketRef: "a19" } });
  await item("bseen-step2", { source: "basecamp", kind: "todo", title: "ajustar onboarding, paso 2", project: "Bseen", excerpt: "To-do asignado · vence el jueves", need: "reply", station: "todo", waitOn: "you", receivedAt: today("15:10", 2), url: "https://3.basecamp.com/" });
  // En curso
  await item("pr208", { source: "github", kind: "pr_review", title: "#208 · feat: filtros guardados", project: "prospec-admin", excerpt: "Pediste cambios · 3 hilos abiertos", need: "approve_pr", station: "doing", waitOn: "person:autor", receivedAt: today("16:20", 1), url: "https://github.com/" });
  await item("fm-script", { source: "slack", kind: "message", title: "script de migración de tarifas", project: "#freightmate-dev", excerpt: "Matt: “ping me when the script is ready”", need: "reply", station: "doing", waitOn: "you", receivedAt: today("08:40"), meta: { channel: "#freightmate-dev" } });
  await item("a17", { source: "claude", kind: "question", title: "Borrador de respuesta a Freightmate", project: "freightmate", excerpt: "Claude redacta · saldrá a tu firma", need: "decision", station: "doing", waitOn: "claude", receivedAt: today("10:38"), meta: { ticketRef: "a17" } });
  // Esperando
  await item("fm-facturas", { source: "basecamp", kind: "request", title: "aprobar maqueta de facturas", project: "Freightmate", excerpt: "Enviado al cliente ayer, 17:20", need: "reply", station: "waiting", waitOn: "client", receivedAt: today("17:20", 1) });
  await item("pr57", { source: "github", kind: "pr_review", title: "#57 · fix: zona horaria en reportes", project: "scout", excerpt: "Aprobado · falta el deploy de Matt", need: "approve_pr", station: "waiting", waitOn: "person:Matt", receivedAt: today("09:10") });
  await item("pr57-sl", { source: "slack", kind: "message", title: "deploy de #57", project: "#scout-dev", excerpt: "Matt: “deploying after lunch”", need: "reply", station: "waiting", waitOn: "person:Matt", receivedAt: today("09:14"), meta: { channel: "#scout-dev" } });
  await item("a21", { source: "claude", kind: "question", title: "Investigar el 502 en buckhub staging", project: "buckhub", excerpt: "Claude revisa los logs", need: "decision", station: "waiting", waitOn: "claude", receivedAt: today("08:50"), meta: { ticketRef: "a21" } });
  // Hecho hoy
  await item("pr55", { source: "github", kind: "pr_review", title: "#55 · feat: CSV de visitas", project: "scout", station: "done", waitOn: "none", receivedAt: today("07:30") });
  await item("bseen-demo", { source: "basecamp", kind: "request", title: "fecha de demo", project: "Bseen", station: "done", waitOn: "none", receivedAt: today("08:00") });
  await item("matt-staging", { source: "slack", kind: "message", title: "Respuesta a Matt en #buckhub-dev", project: "", station: "done", waitOn: "none", receivedAt: today("08:20") });
  await item("a16", { source: "claude", kind: "question", title: "Ticket a16 · tarifas", project: "freightmate", station: "done", waitOn: "none", receivedAt: today("07:50"), meta: { ticketRef: "a16" } });
  await item("pr339", { source: "github", kind: "pr_review", title: "#339 · aprobado", project: "freightmate-api", station: "done", waitOn: "none", receivedAt: today("07:10") });
}

const TASKS = [
  // [title, lane, station, waitOn, items, synced]
  ["#212 feat: bulk export", "github", "inbox", "you", ["pr212", "pr212-bc"], true],
  ["#88 fix: token refresh", "github", "inbox", "you", ["pr88"], true],
  ["#341 chore: bump prisma to 6.2", "github", "todo", "you", ["pr341"], true],
  ["#208 feat: filtros guardados", "github", "doing", "person:autor", ["pr208"], true],
  ["#57 fix: zona horaria en reportes", "github", "waiting", "person:Matt", ["pr57", "pr57-sl"], true],
  ["#55 feat: CSV de visitas", "github", "done", "none", ["pr55"], true],
  ["Cambio en tarifa por milla", "basecamp", "inbox", "you", ["fm-tarifa"], true],
  ["Exportar reporte semanal a PDF", "basecamp", "todo", "you", ["scout-pdf"], false],
  ["Ajustar onboarding, paso 2", "basecamp", "doing", "you", ["bseen-step2"], true],
  ["Aprobar maqueta de facturas", "basecamp", "waiting", "client", ["fm-facturas"], true],
  ["Confirmar fecha de demo", "basecamp", "done", "none", ["bseen-demo"], true],
  ["Hilo de deploy: confirmar env var", "slack", "inbox", "you", ["scout-deploy"], true],
  ["Suavizar el copy del onboarding", "slack", "todo", "you", ["bseen-copy"], true],
  ["Script de migración de tarifas", "slack", "doing", "you", ["fm-script"], true],
  ["Respuesta a Matt sobre staging", "slack", "done", "none", ["matt-staging"], true],
  ["¿Cierro el to-do de Bseen o espero QA?", "claude", "inbox", "you", ["b14"], true],
  ["Resumir los hilos de Buckhub de la semana", "claude", "todo", "claude", ["a19"], true],
  ["Borrador de respuesta a Freightmate", "claude", "doing", "claude", ["a17"], true],
  ["Investigar el 502 en buckhub staging", "claude", "waiting", "claude", ["a21"], true],
  ["Ticket a16: revisar tarifas", "claude", "done", "none", ["a16"], true],
];

async function seedTasks() {
  let pos = 0;
  for (const [title, source, station, waitOn, keys, synced] of TASKS) {
    const first = items[keys[0]];
    const t = await api("POST", "/api/tasks", {
      ...S,
      title,
      source,
      station,
      waitOn,
      project: first?.project ?? "",
      excerpt: first?.excerpt ?? "",
      position: pos++,
      itemIds: keys.map((k) => items[k].id),
    });
    if (synced) await api("POST", `/api/tasks/${t.id}/sync`, { syncState: "synced", ghItemId: `PVTI_sample_${pos}` });
  }
}

async function seedSalidas() {
  await api("POST", "/api/salidas", {
    ...S,
    source: "slack",
    title: "Respuesta en hilo de deploy",
    context: "Matt: andres can you confirm the env var before 2pm? we are holding the prod deploy",
    destination: { kind: "slack_thread", workspace: "designli.slack.com", channel: "#scout-dev", threadLabel: "09:31 · Matt", postAs: "Andrés Correa" },
    body: "Confirmed, SCOUT_API_URL is set on staging. Prod after 2pm.",
    ownerSession: "lead",
  });
  await api("POST", "/api/salidas", {
    ...S,
    source: "basecamp",
    title: "Respuesta sobre la tarifa por milla",
    context: "¿Pueden tenerlo para el viernes? El cliente lo pidió ayer",
    destination: { kind: "basecamp_comment", project: "Freightmate", recordingTitle: "tarifa por milla", postAs: "Andrés Correa" },
    body: "Sí, lo tenemos para el viernes. Mañana subo una vista previa.",
    ownerSession: "lead",
  });
}

async function seedApproval() {
  await api("POST", "/api/approvals", {
    agent: "dev-sample-1",
    tool: "Bash",
    summary: "Instalar dependencias en el worktree de muestra",
    detail: "pnpm install --frozen-lockfile",
    cwd: "G:/WorkSpace/designli/ops-a",
    hints: ["Bash(pnpm test:*)", "Bash(pnpm check)"],
  });
}

async function main() {
  await api("POST", "/api/sessions", { id: "lead", label: "Lead (muestra)" });
  if (SCENARIO === "first-run") return console.log("first-run: nothing seeded");
  await seedItems();
  await seedTasks();
  if (SCENARIO === "calm") {
    for (const it of Object.values(items)) if (it.station === "inbox") await api("PATCH", `/api/items/${it.id}`, { station: "done" });
  } else {
    await seedSalidas();
    await seedApproval();
  }
  const now = new Date().toISOString();
  for (const s of ["github", "slack", "basecamp"]) await api("PATCH", `/api/sources/${s}`, { health: "ok", lastCheckedAt: now, lastNewAt: today("10:20") });
  if (SCENARIO === "slack-down") await api("PATCH", "/api/sources/slack", { health: "down", note: "MCP sin respuesta" });
  if (SCENARIO === "github-paused") {
    const until = new Date(Date.now() + 20 * 60_000).toISOString();
    await api("PATCH", "/api/sources/github", { health: "degraded", note: "límite de API", backoffUntil: until });
  }
  console.log(`seeded ${Object.keys(items).length} items, ${TASKS.length} tasks (${SCENARIO})`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
