import { describe, expect, it } from "vitest";
import { salidaInput } from "@/lib/api/schemas";
import type { Destination } from "@/lib/domain/types";
import { mentionCount, mentionNames, routeStops } from "./model";

const comment: Destination = {
  kind: "basecamp_comment",
  project: "Scout",
  projectId: "1001",
  recordingId: "5003",
  recordingTitle: "Bucket plan",
  mentions: [
    { id: "9001", name: "Matt Myers" },
    { id: "9002", name: "Ana Ruiz" },
  ],
  postAs: "Andrés Correa",
};

describe("basecamp mentions on the salida card", () => {
  it("routeStops names who is mentioned", () => {
    expect(routeStops(comment).at(-1)).toEqual({ label: "Menciona a", value: "Matt Myers, Ana Ruiz" });
    expect(mentionNames(comment)).toEqual(["Matt Myers", "Ana Ruiz"]);
  });

  it("no mentions, no stop", () => {
    const d: Destination = { ...comment, mentions: undefined };
    expect(routeStops(d).some((s) => s.label === "Menciona a")).toBe(false);
    expect(routeStops({ ...comment, mentions: [] }).some((s) => s.label === "Menciona a")).toBe(false);
  });

  it("the Basecamp count is the destination's ids, never the typed @", () => {
    expect(mentionCount(comment, "hola @Matt")).toBe(2);
    expect(mentionCount({ ...comment, mentions: undefined }, "hola @Matt")).toBe(0);
  });

  it("the Slack count still reads the text", () => {
    const slack: Destination = { kind: "slack_channel", workspace: "designli", channel: "#x", postAs: "A" };
    expect(mentionCount(slack, "hola @Matt <@U1>")).toBe(2);
  });
});

describe("salidaInput mentions", () => {
  const input = (destination: object, source = "basecamp") => ({ source, destination, body: "Hi Matt" });
  const base = { project: "Scout", postAs: "Andrés Correa" };
  const mentions = [{ id: "9001", name: "Matt Myers" }];

  it("a basecamp_comment keeps its mentions", () => {
    const r = salidaInput.parse(input({ kind: "basecamp_comment", ...base, mentions }));
    expect(r.destination).toMatchObject({ kind: "basecamp_comment", mentions });
  });

  it("a comment without mentions is fine", () => {
    expect(salidaInput.safeParse(input({ kind: "basecamp_comment", ...base })).success).toBe(true);
  });

  it("a campfire line and a message-board post with mentions are rejected with a clear message", () => {
    for (const kind of ["basecamp_campfire", "basecamp_message"]) {
      const r = salidaInput.safeParse(input({ kind, ...base, mentions }));
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toMatch(/mentions are only for a basecamp_comment/);
    }
  });

  it("a campfire line without mentions is fine", () => {
    expect(salidaInput.safeParse(input({ kind: "basecamp_campfire", ...base })).success).toBe(true);
  });

  it("a mention needs a non-empty id and name", () => {
    expect(salidaInput.safeParse(input({ kind: "basecamp_comment", ...base, mentions: [{ id: "", name: "x" }] })).success).toBe(false);
    expect(salidaInput.safeParse(input({ kind: "basecamp_comment", ...base, mentions: [{ id: "1", name: " " }] })).success).toBe(false);
  });
});
