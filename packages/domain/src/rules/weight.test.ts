import { describe, expect, it } from "vitest";
import { weight } from "./weight.js";

describe("weight", () => {
  it("returns 7 at all-minimum on the 1-5 slider domain", () => {
    expect(weight({ time: 1, effort: 1, priority: 1 })).toBe(7);
  });

  it("returns 35 at all-maximum", () => {
    expect(weight({ time: 5, effort: 5, priority: 5 })).toBe(35);
  });

  it("weights priority most heavily", () => {
    const priorityHeavy = weight({ time: 1, effort: 1, priority: 5 });
    const timeHeavy = weight({ time: 5, effort: 1, priority: 1 });
    expect(priorityHeavy).toBeGreaterThan(timeHeavy);
  });

  it("past completions keep their original points when a chore's weight is edited", () => {
    const before = weight({ time: 2, effort: 2, priority: 2 });
    const after = weight({ time: 5, effort: 5, priority: 5 });
    expect(before).not.toBe(after);
    expect(before).toBe(14);
  });
});
