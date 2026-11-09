import { describe, expect, it } from "vitest";
import type { Destination, SalidaDetail, SalidaLink, SalidaVersion } from "@/lib/domain/types";
import { copyExactText, COPY_TOAST } from "./copy";
import { conversationHref, conversationLinks, shownText, slackTeamId } from "./model";

type Slack = Extract<Destination, { workspace: string }>;
const sal = (destination: Destination, links: SalidaLink[] = []) => ({ destination, links });
const slack = (o: Partial<Slack> = {}): Destination => ({
  kind: "slack_thread",
  workspace: "Designli",
  channel: "#scout-dev",
  channelId: "C0123ABCD",
  threadTs: "1730640660.118000",
  postAs: "A",
  ...o,
});
const both = { slackDomain: "designli", slackTeamId: "T0ABC123" };

describe("slackTeamId", () => {
  it("takes T… and Enterprise E… ids, upper-cased; anything else is null", () => {
    expect(slackTeamId("T0ABC123")).toBe("T0ABC123");
    expect(slackTeamId(" t0abc123 ")).toBe("T0ABC123");
    expect(slackTeamId("E0ABC123")).toBe("E0ABC123");
    for (const bad of [undefined, null, "", "designli", "C0123", "T", "T0 ABC", "T0ABC&id=X"]) expect(slackTeamId(bad)).toBeNull();
  });
});

describe("conversationLinks (Abrir conversación)", () => {
  it("channel: slack://channel?team=<T>&id=<channel> and the https archives link", () => {
    expect(conversationLinks(sal(slack({ kind: "slack_channel", threadTs: undefined })), both)).toEqual({
      app: "slack://channel?team=T0ABC123&id=C0123ABCD",
      web: "https://designli.slack.com/archives/C0123ABCD",
    });
  });

  it("thread: the app link adds message=<threadTs>; the web link adds /p<ts without the dot>", () => {
    expect(conversationLinks(sal(slack()), both)).toEqual({
      app: "slack://channel?team=T0ABC123&id=C0123ABCD&message=1730640660.118000",
      web: "https://designli.slack.com/archives/C0123ABCD/p1730640660118000",
    });
  });

  it("a thread ts that is not a Slack ts opens the channel instead of a made-up message", () => {
    expect(conversationLinks(sal(slack({ threadTs: "garbage" })), both)).toEqual({
      app: "slack://channel?team=T0ABC123&id=C0123ABCD",
      web: "https://designli.slack.com/archives/C0123ABCD",
    });
  });

  it("without the team id only the https link exists; without the domain only the app link; without both, none", () => {
    expect(conversationLinks(sal(slack()), { slackDomain: "designli" })).toEqual({ app: null, web: "https://designli.slack.com/archives/C0123ABCD/p1730640660118000" });
    expect(conversationLinks(sal(slack()), { slackTeamId: "T0ABC123" })).toEqual({ app: "slack://channel?team=T0ABC123&id=C0123ABCD&message=1730640660.118000", web: null });
    expect(conversationLinks(sal(slack()), {})).toEqual({ app: null, web: null });
    expect(conversationHref(conversationLinks(sal(slack()), {}))).toBeNull();
  });

  it("the app link wins when both exist; the https link is the fallback", () => {
    expect(conversationHref(conversationLinks(sal(slack()), both))).toMatch(/^slack:\/\/channel\?team=T0ABC123&id=C0123ABCD/);
    expect(conversationHref(conversationLinks(sal(slack()), { slackDomain: "designli" }))).toMatch(/^https:\/\/designli\.slack\.com\/archives\//);
  });

  it("the domain may come from an origin link to the same channel, never from the workspace label", () => {
    const origin: SalidaLink = { source: "slack", label: "hilo", url: "https://acme.slack.com/archives/C0123ABCD/p1730640660118000" };
    expect(conversationLinks(sal(slack(), [origin]), {})?.web).toBe("https://acme.slack.com/archives/C0123ABCD/p1730640660118000");
    expect(conversationLinks(sal(slack({ workspace: "designli.slack.com" })), {})?.web).toBeNull();
  });

  it("a U… destination opens that person's DM; a D… channel is a plain channel link", () => {
    expect(conversationLinks(sal(slack({ kind: "slack_channel", channelId: "U0AP2KCHP", threadTs: undefined })), both)).toEqual({
      app: "slack://user?team=T0ABC123&id=U0AP2KCHP",
      web: "https://designli.slack.com/team/U0AP2KCHP",
    });
    expect(conversationLinks(sal(slack({ kind: "slack_channel", channelId: "D076LJRFB0U", threadTs: undefined })), both)?.app).toBe("slack://channel?team=T0ABC123&id=D076LJRFB0U");
  });

  it("a missing or malformed channel id gives no link, and a query-injecting one is refused", () => {
    expect(conversationLinks(sal(slack({ channelId: undefined })), both)).toEqual({ app: null, web: null });
    expect(conversationLinks(sal(slack({ channelId: "C1&team=T9" })), both)).toEqual({ app: null, web: null });
    expect(conversationLinks(sal(slack({ channelId: "C1/../x" })), both)).toEqual({ app: null, web: null });
  });

  it("is not for Basecamp or GitHub", () => {
    expect(conversationLinks(sal({ kind: "basecamp_comment", project: "Scout", postAs: "A" }), both)).toBeNull();
    expect(conversationLinks(sal({ kind: "github_comment", repo: "a/b", pr: 1, postAs: "A" }), both)).toBeNull();
  });
});

describe("shownText (what Copiar copies)", () => {
  const v = (n: number, body: string): SalidaVersion => ({ id: `v${n}`, salidaId: "s", n, body, author: "claude", turnId: null, starred: false, createdAt: "x" });
  const base = (o: Partial<Pick<SalidaDetail, "status" | "currentVersion" | "approvedVersion">>) => ({
    status: "pending" as SalidaDetail["status"],
    currentVersion: 2,
    approvedVersion: null as number | null,
    versions: [v(1, "uno  \n"), v(2, "dos\n\n  con espacios  ")],
    ...o,
  });

  it("is the current version while it can still change, byte for byte", () => {
    expect(shownText(base({}))).toBe("dos\n\n  con espacios  ");
    expect(shownText(base({ status: "draft" }))).toBe("dos\n\n  con espacios  ");
  });

  it("is the approved version once approved, even if another one is selected", () => {
    for (const status of ["sending", "scheduled", "queued_until_back", "draft_created", "failed", "sent"] as const) {
      expect(shownText(base({ status, approvedVersion: 1 }))).toBe("uno  \n");
    }
  });

  it("falls back to the current version when nothing was approved, and to empty when the version is missing", () => {
    expect(shownText(base({ status: "sending" }))).toBe("dos\n\n  con espacios  ");
    expect(shownText({ ...base({}), versions: [] })).toBe("");
  });
});

describe("copyExactText (Copiar)", () => {
  it("writes the exact text with the Clipboard API", async () => {
    const written: string[] = [];
    const text = "Hola  Ana,\n\n  confirmado.  ";
    expect(await copyExactText(text, { clipboard: { writeText: async (t) => void written.push(t) } })).toBe("copied");
    expect(written).toEqual([text]);
  });

  it("falls back to selecting the text when the clipboard is unavailable or refuses", async () => {
    let selected = 0;
    const select = () => (selected++, true);
    expect(await copyExactText("x", { clipboard: null, select })).toBe("selected");
    expect(await copyExactText("x", { select })).toBe("selected");
    expect(await copyExactText("x", { clipboard: { writeText: () => Promise.reject(new Error("denied")) }, select })).toBe("selected");
    expect(selected).toBe(3);
  });

  it("fails when there is nothing to copy or neither route works", async () => {
    expect(await copyExactText("", { clipboard: { writeText: async () => {} }, select: () => true })).toBe("failed");
    expect(await copyExactText("x", { clipboard: null, select: () => false })).toBe("failed");
    expect(await copyExactText("x", { clipboard: null })).toBe("failed");
    expect(
      await copyExactText("x", {
        select: () => {
          throw new Error("no DOM");
        },
      }),
    ).toBe("failed");
  });

  it("has a short Spanish toast per outcome", () => {
    expect(COPY_TOAST.copied).toBe("Texto copiado");
    expect(Object.keys(COPY_TOAST).sort()).toEqual(["copied", "failed", "selected"]);
  });
});
