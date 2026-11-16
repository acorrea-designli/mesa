// t190: documents with versions.
import { describe, expect, it } from "vitest";
import { documentIdOf, groupDocuments, versionTag } from "./attachments";

const v = (id: string, versionOf: string | null, version: number, createdAt = "2026-11-12T10:00:00.000Z") => ({ id, versionOf, version, createdAt });

describe("groupDocuments", () => {
  it("groups a root with its versions, oldest first, and names the latest", () => {
    const docs = groupDocuments([v("a", null, 1), v("b", null, 1), v("a3", "a", 3), v("a2", "a", 2)]);
    expect(docs.map((d) => d.documentId)).toEqual(["a", "b"]);
    expect(docs[0]!.versions.map((x) => x.id)).toEqual(["a", "a2", "a3"]);
    expect(docs[0]!.latest.id).toBe("a3");
    expect(docs[1]!.latest.id).toBe("b");
  });

  it("works when a version comes before its root", () => {
    const docs = groupDocuments([v("a2", "a", 2), v("a", null, 1)]);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.documentId).toBe("a");
    expect(docs[0]!.latest.id).toBe("a2");
  });

  it("identifies the document by the root and tags only later versions", () => {
    expect(documentIdOf({ id: "a2", versionOf: "a" })).toBe("a");
    expect(documentIdOf({ id: "a", versionOf: null })).toBe("a");
    expect(versionTag({ version: 1 })).toBe("");
    expect(versionTag({ version: 3 })).toBe("v3");
  });
});
