import { describe, expect, it } from "vitest";
import { approve, decline, NO_RESET, propose } from "./reset.js";
import type { ResetProposal } from "./reset.js";

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

  it("leaves an already-approved proposal alone, however it is re-tapped", () => {
    const approved: ResetProposal = approve(propose("apoorva"), "friend");
    expect(approved).toEqual({ state: "approved", proposedBy: "apoorva" });

    // A replayed mutation or a double-tap must not settle it a second time. Declining
    // an approved proposal is the case that shows the guard is doing the work: without
    // it the wipe everybody agreed to would silently become a refusal.
    expect(decline(approved, "friend")).toEqual(approved);
    expect(decline(approved, "apoorva")).toEqual(approved);
    expect(approve(approved, "friend")).toEqual(approved);
    expect(approve(approved, "third")).toEqual(approved);
  });

  it("leaves an already-declined proposal alone, however it is re-tapped", () => {
    const declined: ResetProposal = decline(propose("apoorva"), "friend");
    expect(declined).toEqual({ state: "declined", proposedBy: "apoorva" });

    // The mirror case: a retry must not turn a refusal into a wipe.
    expect(approve(declined, "friend")).toEqual(declined);
    expect(approve(declined, "third")).toEqual(declined);
    expect(decline(declined, "friend")).toEqual(declined);
  });

  it("cannot settle a proposal that was never made", () => {
    expect(approve(NO_RESET, "friend")).toEqual(NO_RESET);
    expect(decline(NO_RESET, "friend")).toEqual(NO_RESET);
  });
});
