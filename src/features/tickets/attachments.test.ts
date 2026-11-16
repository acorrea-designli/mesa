// t135: where a thread shows each attachment.
import { describe, expect, it } from "vitest";
import type { Attachment } from "@/lib/domain/types";
import { isPdf, latestPdfs, placeAttachments, reviewTargets } from "./attachments";

const att = (id: string, messageId: string | null, mime = "application/pdf", versionOf: string | null = null, version = 1): Attachment => ({
  id,
  ticketId: "tk_1",
  messageId,
  filename: `${id}.pdf`,
  mime,
  size: 1,
  path: `tk_1/${id}`,
  createdAt: "2026-11-12T10:00:00.000Z",
  reviewedAt: null,
  approvedAt: null,
  versionOf,
  version,
});
const msgs = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];

describe("placeAttachments", () => {
  it("puts an attachment only under its own message", () => {
    const p = placeAttachments([att("a", "m2"), att("b", "m3"), att("c", "m2")], msgs);
    expect(p.byMessage.get("m2")?.map((a) => a.id)).toEqual(["a", "c"]);
    expect(p.byMessage.get("m3")?.map((a) => a.id)).toEqual(["b"]);
    expect(p.byMessage.has("m1")).toBe(false);
    expect(p.tail).toEqual([]);
  });

  it("sends an attachment with no message to the end of the thread, never under the first message", () => {
    const p = placeAttachments([att("a", null), att("b", "m1"), att("c", null)], msgs);
    expect(p.byMessage.get("m1")?.map((a) => a.id)).toEqual(["b"]);
    expect(p.tail.map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("keeps an attachment whose message is gone at the end instead of dropping it", () => {
    const p = placeAttachments([att("a", "m_gone")], msgs);
    expect(p.tail.map((a) => a.id)).toEqual(["a"]);
    expect(p.byMessage.size).toBe(0);
  });

  it("works on a thread without messages", () => {
    expect(placeAttachments([att("a", null)], []).tail).toHaveLength(1);
    expect(placeAttachments([], msgs)).toEqual({ byMessage: new Map(), tail: [] });
  });
});

describe("isPdf", () => {
  it("is true for application/pdf only", () => {
    expect(isPdf(att("a", null))).toBe(true);
    expect(isPdf(att("b", null, "image/png"))).toBe(false);
  });
});

describe("versions (t190)", () => {
  const list = [att("a", "m1"), att("b", "m1"), att("a2", "m2", "application/pdf", "a", 2), att("a3", "m3", "application/pdf", "a", 3)];

  it("lists one PDF per document: its latest version", () => {
    expect(latestPdfs(list).map((a) => a.id)).toEqual(["a3", "b"]);
  });

  it("points every version of a document at the latest, so Revisar opens it", () => {
    const t = reviewTargets(list);
    expect(t.get("a")).toBe("a3");
    expect(t.get("a2")).toBe("a3");
    expect(t.get("b")).toBe("b");
  });
});
