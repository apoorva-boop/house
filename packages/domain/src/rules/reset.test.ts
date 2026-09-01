import { describe, expect, it } from "vitest";
import { approve, decline, propose } from "./reset.js";

describe("reset", () => {
  it("moves to proposed when one person proposes", () => {
    expect(propose("apoorva").state).toBe("proposed");
    expect(propose("apoorva").proposedBy).toBe("apoorva");
  });

  it("cannot be approved by the person who proposed it", () => {
    expect(approve(propose("apoorva"), "apoorva").state).toBe("proposed");
  });

  it("is approved when the other person approves", () => {
    expect(approve(propose("apoorva"), "friend").state).toBe("approved");
  });

  it("changes nothing when declined", () => {
    expect(decline(propose("apoorva"), "friend").state).toBe("declined");
  });
});
