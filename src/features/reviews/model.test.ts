import { describe, expect, it } from "vitest";
import { postable, takesActions } from "./model";

const finding = { state: "open" as const, salidaId: null, ghCommentId: null };

describe("review card controls", () => {
  it("only an open review takes actions; a closed card has no buttons", () => {
    expect(takesActions({ state: "open" })).toBe(true);
    for (const state of ["closed", "approving", "approved"] as const) expect(takesActions({ state }), state).toBe(false);
  });

  it("a closed card's open findings cannot be picked or posted", () => {
    expect(postable({ state: "open" }, finding)).toBe(true);
    expect(postable({ state: "closed" }, finding)).toBe(false);
    expect(postable({ state: "open" }, { ...finding, salidaId: "sa_1" })).toBe(false);
    expect(postable({ state: "open" }, { ...finding, state: "dismissed" as never })).toBe(false);
  });
});
