import { describe, expect, it } from "vitest";
import type { Item, Salida } from "@/lib/domain/types";
import { mapHealth, railHealth } from "@/components/shell/health";
import { destinationLabel, isCalm, itemRow, itemSubject, needLabel, salidaRow, skipTarget, skipTargets, skipToast, sourceCounts, visibleRows, waitTag, withTicketNeed } from "./model";

const base: Item = {
  id: "it_1",
  source: "github",
  externalId: "pr:o/r#1",
  kind: "pr_review",
  title: "#212 · feat: bulk export",
  excerpt: "Review solicitado",
  project: "prospec-admin",
  url: null,
  need: "approve_pr",
  station: "inbox",
  waitOn: "you",
  tag: null,
  taskId: null,
  meta: {},
  isSample: true,
  skippedAt: null,
  receivedAt: "2026-11-03T14:02:00.000Z",
  createdAt: "2026-11-03T14:02:00.000Z",
  updatedAt: "2026-11-03T14:02:00.000Z",
};

const state = (source: "github" | "slack", health: "ok" | "degraded" | "down", extra: object = {}) => ({
  source,
  health,
  note: "",
  watermark: null,
  lastChecked: "2026-11-03T15:20:00.000Z",
  errorCount: 0,
  lastError: null,
  lastNewAt: null,
  backoffUntil: null,
  cadenceS: 60,
  updatedAt: "2026-11-03T15:20:00.000Z",
  ...extra,
});

describe("labels", () => {
  it("maps needs and wait tags; only Te espera is solid", () => {
    expect(needLabel("approve_pr")).toBe("Aprobar PR");
    expect(needLabel("reply")).toBe("Respuesta");
    expect(waitTag("you", "inbox")).toEqual({ tone: "you", label: "Te espera" });
    expect(waitTag("you", "inbox", "clean")).toEqual({ tone: "ok", label: "Limpio" });
    expect(waitTag("claude", "doing")).toEqual({ tone: "cl", label: "Espera a Claude" });
    expect(waitTag("person:Matt", "waiting")).toEqual({ tone: "plain", label: "Espera a Matt" });
    expect(waitTag("you", "done").tone).toBe("plain");
  });

  it("a skipped item in Hecho reads Saltado; Saltar applies to open, non-sample items only", () => {
    expect(waitTag("none", "done")).toEqual({ tone: "plain", label: "Hecho" });
    expect(waitTag("none", "done", null, true)).toEqual({ tone: "plain", label: "Saltado" });
    const skipped = { ...base, station: "done" as const, waitOn: "none" as const, skippedAt: "2026-11-03T15:00:00.000Z" };
    expect(itemRow(skipped, "09:02").tag.label).toBe("Saltado");
    expect(itemRow({ ...skipped, skippedAt: null }, "09:02").tag.label).toBe("Hecho");
    const open = { ...base, isSample: false, station: "waiting" as const, waitOn: "client" as const };
    expect(skipTarget(open)).toEqual({ id: "it_1", station: "waiting", waitOn: "client" });
    expect(skipTarget(skipped)).toBeNull();
    expect(skipTarget({ ...open, isSample: true })).toBeNull();
  });

  it("batch Saltar sends only the selected items with a skip target, each with its own station and waitOn", () => {
    const open = { ...base, isSample: false, station: "waiting" as const, waitOn: "client" as const };
    const a = { kind: "item" as const, skip: skipTarget(open) };
    const b = { kind: "item" as const, skip: skipTarget({ ...open, id: "it_2", station: "doing" as const, waitOn: "claude" as const }) };
    const sample = { kind: "item" as const, skip: skipTarget(base) };
    const done = { kind: "item" as const, skip: skipTarget({ ...open, station: "done" as const }) };
    const salida = { kind: "salida" as const, skip: skipTarget(open) };
    expect(skipTargets([a, sample, b, done, salida])).toEqual([
      { id: "it_1", station: "waiting", waitOn: "client" },
      { id: "it_2", station: "doing", waitOn: "claude" },
    ]);
    expect(skipTargets([sample, done])).toEqual([]);
  });

  it("words the batch Saltar toast, with failures", () => {
    expect(skipToast(1, 0)).toBe("Saltado: sale de Hoy");
    expect(skipToast(3, 0)).toBe("Saltados: 3 salen de Hoy");
    expect(skipToast(2, 1)).toBe("Saltados: 2 salen de Hoy · No se pudo saltar 1");
    expect(skipToast(1, 2)).toBe("Saltado: sale de Hoy · No se pudieron saltar 2");
    expect(skipToast(0, 3)).toBe("No se pudieron saltar 3");
    expect(skipToast(0, 1)).toBe("No se pudo saltar 1");
  });

  it("prefixes the project except for Claude questions", () => {
    expect(itemSubject(base)).toBe("prospec-admin · #212 · feat: bulk export");
    expect(itemSubject({ ...base, source: "claude", title: "¿Cierro el to-do?" })).toBe("¿Cierro el to-do?");
    expect(itemSubject({ ...base, title: "prospec-admin #212" })).toBe("prospec-admin #212");
  });

  it("names destinations in one line", () => {
    expect(destinationLabel({ kind: "slack_thread", workspace: "w", channel: "#scout-dev", threadLabel: "Matt", postAs: "A" })).toBe("#scout-dev · hilo de Matt");
    expect(destinationLabel({ kind: "basecamp_comment", project: "Freightmate", recordingTitle: "tarifa", postAs: "A" })).toBe("Freightmate · tarifa");
    expect(destinationLabel({ kind: "github_review", repo: "o/r", pr: 3, postAs: "A" })).toBe("o/r#3");
  });
});

describe("rows", () => {
  it("marks rows of a down source as Sin datos with the last data time", () => {
    const h = mapHealth(state("slack", "down", { lastNewAt: "2026-11-03T15:20:00.000Z" }));
    const r = itemRow({ ...base, source: "slack" }, "09:31", h);
    expect(r.stale).toBe(true);
    expect(r.tag).toEqual({ tone: "off", label: "Sin datos" });
    expect(r.excerpt).toMatch(/^Último dato \d\d:\d\d · Slack no responde$/);
  });

  it("carries the files chip of an item with meta.files, and none otherwise", () => {
    expect(itemRow(base, "09:02").files).toBeNull();
    const img = { ...base, source: "slack" as const, meta: { files: [{ id: "F0CG7DCM8KC", name: "image.png", mime: "image/png" }] } };
    expect(itemRow(img, "09:02").files?.label).toBe("imagen");
    const two = { ...img, meta: { files: [{ id: "a", name: "a", mime: "image/png" }, { id: "b", name: "b", mime: "application/pdf" }] } };
    expect(itemRow(two, "09:02").files?.label).toBe("adjunto · 2");
  });

  it("keeps the tag but notes the pause for a degraded source", () => {
    const h = mapHealth(state("github", "degraded", { backoffUntil: "2026-11-03T16:05:00.000Z" }));
    const r = itemRow(base, "09:02", h);
    expect(r.tag.label).toBe("Te espera");
    expect(r.excerpt).toMatch(/GitHub en pausa hasta \d\d:\d\d/);
  });

  it("puts salidas in their own group, only on Inbox", () => {
    const s = { id: "sa_1", source: "slack", title: "t", destination: { kind: "slack_channel", workspace: "w", channel: "#x", postAs: "A" } } as Salida;
    const rows = [itemRow(base, "09:02"), itemRow({ ...base, id: "it_2", station: "todo" }, "x"), salidaRow(s, "\nHola\nsegunda", "10:38")];
    expect(rows[2]?.excerpt).toBe("“Hola”");
    expect(rows[2]?.tag).toEqual({ tone: "you", label: "Por enviar" });
    expect(rows[2]?.phoneTag.label).toBe("Firmar");
    const inbox = visibleRows(rows, "inbox", "all");
    expect(inbox.items).toHaveLength(1);
    expect(inbox.salidas).toHaveLength(1);
    expect(visibleRows(rows, "todo", "all").salidas).toHaveLength(0);
    expect(visibleRows(rows, "inbox", "github").salidas).toHaveLength(0);
    expect(sourceCounts(rows, "inbox")).toMatchObject({ all: 2, github: 1, slack: 1 });
  });

  it("is calm only when nothing waits", () => {
    const stations = { inbox: 0, todo: 2, doing: 0, waiting: 0, done: 3 };
    expect(isCalm({ stations, rows: [], approvals: [] })).toBe(true);
    expect(isCalm({ stations: { ...stations, inbox: 1 }, rows: [], approvals: [] })).toBe(false);
  });
});

describe("rail health", () => {
  it("stays quiet while every source is ok", () => {
    expect(railHealth([state("github", "ok"), state("slack", "ok")], true)).toEqual([]);
  });

  it("lists every source plus Claude when one is down", () => {
    const rows = railHealth([state("github", "ok"), state("slack", "down")], true);
    expect(rows.map((r) => [r.name, r.note])).toEqual([
      ["GitHub", "al día"],
      ["Slack", "sin conexión"],
      ["Basecamp", "al día"],
      ["Claude", "escucha"],
    ]);
  });
});

describe("withTicketNeed", () => {
  const claudeWaits = { ...base, waitOn: "claude" as const, need: "reply", tag: null, station: "doing" as const };
  const need = [{ label: "Aprobar plan" }, { label: "Firmar salida" }];

  it("names the first need in Necesita and reads Te espera, whatever the item waits on", () => {
    const row = withTicketNeed(itemRow(claudeWaits, "09:02"), need);
    expect(row.need).toBe("Aprobar plan");
    expect(row.tag).toEqual({ tone: "you", label: "Te espera" });
    expect(row.phoneTag).toEqual({ tone: "you", label: "Te espera" });
    expect(row.waitsOnYou).toBe(true);
  });

  it("a ticket with no needs shows its own status tag instead of the item's Te espera", () => {
    const waitsOnYou = itemRow({ ...base, waitOn: "you", station: "waiting" }, "09:02");
    expect(waitsOnYou.tag.label).toBe("Te espera");
    const claude = withTicketNeed(waitsOnYou, [], "waiting_claude");
    expect(claude.tag).toEqual({ tone: "cl", label: "Espera a Claude" });
    expect(claude.phoneTag).toEqual({ tone: "cl", label: "Espera a Claude" });
    expect(claude.waitsOnYou).toBe(false);
    expect(withTicketNeed(waitsOnYou, [], "working").tag).toEqual({ tone: "cl", label: "Claude trabaja" });
    // rows with needs are unchanged by the status; a row that does not read Te espera keeps its tag
    expect(withTicketNeed(waitsOnYou, need, "waiting_claude").tag.label).toBe("Te espera");
    const clWaits = itemRow(claudeWaits, "09:02");
    expect(withTicketNeed(clWaits, [], "working")).toBe(clWaits);
    // no ticket detail: unchanged
    expect(withTicketNeed(waitsOnYou, undefined, "waiting_claude")).toBe(waitsOnYou);
  });

  it("leaves rows without needs, done rows and salidas unchanged", () => {
    const row = itemRow(claudeWaits, "09:02");
    expect(withTicketNeed(row, [])).toBe(row);
    expect(withTicketNeed(row, undefined)).toBe(row);
    const done = itemRow({ ...claudeWaits, station: "done" }, "09:02");
    expect(withTicketNeed(done, need)).toBe(done);
    const sal = salidaRow({ id: "sa_1", source: "slack", title: "t", destination: { kind: "slack_channel", workspace: "w", channel: "#a", postAs: "x" } } as Salida, "Hola", "10:38");
    expect(withTicketNeed(sal, need)).toBe(sal);
  });
});
