import { describe, expect, it } from "vitest";
import { firstLine, repeatsReviewCard } from "./review-repeat";

const claude = (body: string, options?: unknown[] | null) => ({ author: "claude", body, options });
const finds = [{ at: "src/api/eval.ts:42" }, { at: "src/lib/util.ts:3-9" }, { at: "" }];
const longList = "4 hallazgos.\n1. src/api/eval.ts:42 falta el permiso.\n2. src/lib/util.ts:3 renombrar.\n3. otro.";

describe("repeatsReviewCard", () => {
  it("folds a long Claude reply with a path:line on a ticket with a review", () => {
    expect(repeatsReviewCard(claude(longList), finds, true)).toBe(true);
    expect(repeatsReviewCard(claude("uno\ndos\nver x.tsx:7"), [], true)).toBe(true);
  });

  it("folds a long reply that names the file of a finding without a line", () => {
    expect(repeatsReviewCard(claude("Resumen\nel cambio en src/api/eval.ts\nfalta el permiso"), finds, true)).toBe(true);
    expect(repeatsReviewCard(claude("Resumen\nsolo src/lib/util.ts\nlisto"), finds, true)).toBe(true);
  });

  it("leaves a 2-line reply alone, even with a path", () => {
    expect(repeatsReviewCard(claude("1 blocker.\nDetalle en src/api/eval.ts:42"), finds, true)).toBe(false);
    expect(repeatsReviewCard(claude("1 blocker, 2 nits."), finds, true)).toBe(false);
    expect(repeatsReviewCard(claude("uno\n\n\ndos\n\n"), finds, true)).toBe(false);
  });

  it("leaves a ticket without a review alone", () => {
    expect(repeatsReviewCard(claude(longList), finds, false)).toBe(false);
  });

  it("leaves Andrés's messages alone", () => {
    expect(repeatsReviewCard({ author: "andres", body: longList }, finds, true)).toBe(false);
  });

  it("leaves a long reply with no path alone", () => {
    expect(repeatsReviewCard(claude("uno\ndos\ntres\ncuatro, versión 1.2 y t16:3"), finds, true)).toBe(false);
    expect(repeatsReviewCard(claude("a\nb\nc\nlocalhost 127.0.0.1:8790"), finds, true)).toBe(false);
  });

  it("does not fold a message that carries options", () => {
    expect(repeatsReviewCard(claude(longList, [{ key: "A" }]), finds, true)).toBe(false);
  });

  it("ignores findings with no file (conversation comments)", () => {
    expect(repeatsReviewCard(claude("a\nb\nc"), [{ at: "" }], true)).toBe(false);
  });
});

describe("firstLine", () => {
  it("returns the first non-empty line", () => {
    expect(firstLine("\n  hola  \nresto")).toBe("hola");
    expect(firstLine("")).toBe("");
  });
});
