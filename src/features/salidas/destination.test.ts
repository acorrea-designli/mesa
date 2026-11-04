import { describe, expect, it } from "vitest";
import type { Destination, SalidaLink } from "@/lib/domain/types";
import { basecampAccountId, destinationLinkLabel, destinationUrl, slackSubdomain } from "./model";

type Slack = Extract<Destination, { workspace: string }>;
type Basecamp = Extract<Destination, { project: string }>;
type Github = Extract<Destination, { repo: string }>;

const sal = (destination: Destination, extra: { permalink?: string | null; links?: SalidaLink[] } = {}) => ({
  destination,
  permalink: extra.permalink ?? null,
  links: extra.links ?? [],
});
const cfg = { slackDomain: "designli", basecampAccount: "1234567" };
const slack = (o: Partial<Slack> = {}): Destination => ({
  kind: "slack_thread",
  workspace: "Designli",
  channel: "#scout-dev",
  channelId: "C0SAMPLE01",
  threadTs: "1730640660.118000",
  postAs: "A",
  ...o,
});
const bc = (o: Partial<Basecamp> = {}): Destination => ({ kind: "basecamp_comment", project: "Scout", projectId: "1001", recordingId: "5003", postAs: "A", ...o });
const gh = (o: Partial<Github> = {}): Destination => ({ kind: "github_comment", repo: "designli/scout", pr: 59, postAs: "A", ...o });

describe("destinationUrl", () => {
  it("github: the PR, the discussion when replying, the files view for an inline comment", () => {
    expect(destinationUrl(sal(gh({ kind: "github_review", event: "APPROVE" })))).toBe("https://github.com/designli/scout/pull/59");
    expect(destinationUrl(sal(gh()))).toBe("https://github.com/designli/scout/pull/59");
    expect(destinationUrl(sal(gh({ inReplyTo: "998877" })))).toBe("https://github.com/designli/scout/pull/59#discussion_r998877");
    expect(destinationUrl(sal(gh({ path: "src/a.ts", line: 4 })))).toBe("https://github.com/designli/scout/pull/59/files");
  });

  it("github: a bad repo or PR gives null; a bad reply id falls back to the PR", () => {
    expect(destinationUrl(sal(gh({ repo: "scout" })))).toBeNull();
    expect(destinationUrl(sal(gh({ repo: "a/b/../c" })))).toBeNull();
    expect(destinationUrl(sal(gh({ pr: 0 })))).toBeNull();
    expect(destinationUrl(sal(gh({ inReplyTo: "x y" })))).toBe("https://github.com/designli/scout/pull/59");
  });

  it("slack thread and channel from the config", () => {
    expect(destinationUrl(sal(slack()), cfg)).toBe("https://designli.slack.com/archives/C0SAMPLE01/p1730640660118000");
    expect(destinationUrl(sal(slack({ kind: "slack_channel", threadTs: undefined })), cfg)).toBe("https://designli.slack.com/archives/C0SAMPLE01");
  });

  it("slack: a missing domain, channel id or thread ts gives null", () => {
    expect(destinationUrl(sal(slack()))).toBeNull();
    expect(destinationUrl(sal(slack({ channelId: undefined })), cfg)).toBeNull();
    expect(destinationUrl(sal(slack({ threadTs: undefined })), cfg)).toBeNull();
    expect(destinationUrl(sal(slack({ threadTs: "garbage" })), cfg)).toBeNull();
    expect(destinationUrl(sal(slack({ kind: "slack_channel", channelId: undefined })), cfg)).toBeNull();
  });

  it("slack domain comes from an origin link to the same channel, never from the workspace label", () => {
    const origin: SalidaLink = { source: "slack", label: "hilo", url: "https://acme.slack.com/archives/C0SAMPLE01/p1730640660118000" };
    expect(destinationUrl(sal(slack(), { links: [origin] }))).toBe("https://acme.slack.com/archives/C0SAMPLE01/p1730640660118000");
    expect(destinationUrl(sal(slack({ kind: "slack_channel", threadTs: undefined }), { links: [origin] }))).toBe("https://acme.slack.com/archives/C0SAMPLE01");
    // the workspace is a free label: even a host-like one is not a source for the domain
    expect(destinationUrl(sal(slack({ workspace: "designli.slack.com" })))).toBeNull();
    // a link to another channel says nothing about this one
    const otherChannel: SalidaLink = { source: "slack", label: "otro", url: "https://acme.slack.com/archives/C0OTHER99/p1" };
    expect(destinationUrl(sal(slack(), { links: [otherChannel] }))).toBeNull();
    // a link from another source, without a URL, or not an archives link, says nothing either
    const noise: SalidaLink[] = [
      { source: "github", label: "PR", url: "https://acme.slack.com/archives/C0SAMPLE01/p1" },
      { source: "slack", label: "sin url" },
      { source: "slack", label: "home", url: "https://acme.slack.com/" },
    ];
    expect(destinationUrl(sal(slack(), { links: noise }))).toBeNull();
    // the config wins over the origin link
    expect(destinationUrl(sal(slack(), { links: [origin] }), cfg)).toContain("https://designli.slack.com/");
  });

  it("basecamp comment, message and campfire", () => {
    expect(destinationUrl(sal(bc()), cfg)).toBe("https://3.basecamp.com/1234567/buckets/1001/recordings/5003");
    expect(destinationUrl(sal(bc({ kind: "basecamp_message" })), cfg)).toBe("https://3.basecamp.com/1234567/buckets/1001/recordings/5003");
    expect(destinationUrl(sal(bc({ kind: "basecamp_campfire" })), cfg)).toBe("https://3.basecamp.com/1234567/buckets/1001/chats/5003");
  });

  it("basecamp: a missing account, project or recording gives null", () => {
    expect(destinationUrl(sal(bc()))).toBeNull();
    expect(destinationUrl(sal(bc({ projectId: undefined })), cfg)).toBeNull();
    expect(destinationUrl(sal(bc({ recordingId: undefined })), cfg)).toBeNull();
    expect(destinationUrl(sal(bc({ kind: "basecamp_campfire", recordingId: undefined })), cfg)).toBeNull();
    expect(destinationUrl(sal(bc({ recordingId: "../x" })), cfg)).toBeNull();
    expect(destinationUrl(sal(bc()), { basecampAccount: "not-a-number" })).toBeNull();
  });

  it("basecamp account comes from an origin link to the same bucket only", () => {
    const origin: SalidaLink = { source: "basecamp", label: "To-do", url: "https://3.basecamp.com/7654321/buckets/1001/todos/9" };
    expect(destinationUrl(sal(bc(), { links: [origin] }))).toBe("https://3.basecamp.com/7654321/buckets/1001/recordings/5003");
    expect(destinationUrl(sal(bc({ kind: "basecamp_campfire" }), { links: [origin] }))).toBe("https://3.basecamp.com/7654321/buckets/1001/chats/5003");
    // another bucket (project) gives null
    const otherBucket: SalidaLink = { source: "basecamp", label: "otro", url: "https://3.basecamp.com/7654321/buckets/2002/todos/9" };
    expect(destinationUrl(sal(bc(), { links: [otherBucket] }))).toBeNull();
    // a non-basecamp host, or a link with no bucket, gives null
    const sample: SalidaLink = { source: "basecamp", label: "x", url: "https://basecamp.example.com/0000000/buckets/1001/recordings/2" };
    const noBucket: SalidaLink = { source: "basecamp", label: "y", url: "https://3.basecamp.com/7654321/projects" };
    expect(destinationUrl(sal(bc(), { links: [sample, noBucket] }))).toBeNull();
  });

  it("the permalink wins after the send, for every kind", () => {
    const permalink = "https://designli.slack.com/archives/C0SAMPLE01/p1730999999000100";
    expect(destinationUrl(sal(slack(), { permalink }), cfg)).toBe(permalink);
    expect(destinationUrl(sal(slack(), { permalink }))).toBe(permalink); // even without the config
    const ghLink = "https://github.com/designli/scout/pull/59#issuecomment-1";
    expect(destinationUrl(sal(gh(), { permalink: ghLink }))).toBe(ghLink);
    const bcLink = "https://3.basecamp.com/1/buckets/2/recordings/3#__recording_4";
    expect(destinationUrl(sal(bc(), { permalink: bcLink }), cfg)).toBe(bcLink);
  });

  it("a simulated permalink is not a link: it falls back to the destination", () => {
    expect(destinationUrl(sal(gh(), { permalink: "simulated://sandbox/s1" }))).toBe("https://github.com/designli/scout/pull/59");
    expect(destinationUrl(sal(slack(), { permalink: "simulated://sandbox/s1" }))).toBeNull();
  });

  it("normalizes the config values", () => {
    expect(slackSubdomain("designli")).toBe("designli");
    expect(slackSubdomain(" Designli.slack.com ")).toBe("designli");
    expect(slackSubdomain("https://designli.slack.com/archives/C1")).toBe("designli");
    expect(slackSubdomain("evil.com")).toBeNull();
    expect(slackSubdomain("a b")).toBeNull();
    expect(slackSubdomain("")).toBeNull();
    expect(slackSubdomain(undefined)).toBeNull();
    expect(basecampAccountId("1234567")).toBe("1234567");
    expect(basecampAccountId("https://3.basecamp.com/1234567/projects")).toBe("1234567");
    expect(basecampAccountId("https://3.basecamp.com/abc/projects")).toBeNull();
    expect(basecampAccountId(null)).toBeNull();
  });

  it("names the destination in the aria label", () => {
    expect(destinationLinkLabel(gh({ kind: "github_review" }))).toBe("Abrir destino: designli/scout#59");
    expect(destinationLinkLabel(slack({ threadLabel: "Hilo 09:31 · Matt" }))).toBe("Abrir destino: #scout-dev · Hilo 09:31 · Matt");
  });
});
