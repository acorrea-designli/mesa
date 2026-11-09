import { describe, expect, it } from "vitest";
import { chipOfMeta, filesChip, metaFiles } from "./files";

describe("metaFiles", () => {
  it("reads id, name, mime and url, falling back to sgid", () => {
    expect(metaFiles({ files: [{ id: "F1", name: "image.png", mime: "image/png" }, { sgid: "BAh", name: "spec.pdf", mime: "application/pdf", url: "https://x/y" }] })).toEqual([
      { id: "F1", name: "image.png", mime: "image/png", url: null },
      { id: "BAh", name: "spec.pdf", mime: "application/pdf", url: "https://x/y" },
    ]);
  });
  it("ignores a missing, non-array or malformed files value", () => {
    expect(metaFiles(undefined)).toEqual([]);
    expect(metaFiles({})).toEqual([]);
    expect(metaFiles({ files: "F1" })).toEqual([]);
    expect(metaFiles({ files: [null, 3, "x"] })).toEqual([]);
  });
});

describe("filesChip", () => {
  it("is null without files", () => {
    expect(filesChip([])).toBeNull();
    expect(chipOfMeta({ channel: "#a" })).toBeNull();
  });
  it("says imagen for one image and counts when there are several", () => {
    expect(filesChip([{ mime: "image/png" }])).toEqual({ kind: "imagen", label: "imagen", count: 1 });
    expect(filesChip([{ mime: "image/png" }, { mime: "IMAGE/jpeg" }])).toEqual({ kind: "imagen", label: "imagen · 2", count: 2 });
  });
  it("says adjunto for anything else, and for a mix", () => {
    expect(filesChip([{ mime: "application/pdf" }])?.label).toBe("adjunto");
    expect(filesChip([{ mime: "" }])?.label).toBe("adjunto");
    expect(filesChip([{ mime: "image/png" }, { mime: "application/pdf" }, { mime: "text/csv" }])?.label).toBe("adjunto · 3");
  });
  it("joins the files of several items", () => {
    expect(chipOfMeta({ files: [{ id: "F1", name: "a", mime: "image/png" }] }, undefined, { files: [{ id: "F2", name: "b", mime: "image/png" }] })?.label).toBe("imagen · 2");
  });
});
