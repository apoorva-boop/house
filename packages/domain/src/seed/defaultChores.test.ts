import { describe, expect, it } from "vitest";
import { defaultChores, weekOneBonus } from "./defaultChores.js";

describe("defaultChores", () => {
  it("seeds roughly thirty chores so setup is not sixty forms", () => {
    const chores = defaultChores();
    expect(chores.length).toBeGreaterThanOrEqual(25);
    expect(chores.length).toBeLessThanOrEqual(40);
  });

  it("covers all three assets", () => {
    const assets = new Set(defaultChores().map((c) => c.assetId));
    expect(assets).toEqual(new Set(["house", "garden", "car"]));
  });

  it("pre-fills every slider on the 1-5 domain", () => {
    for (const c of defaultChores()) {
      for (const v of [c.weight.time, c.weight.effort, c.weight.priority]) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(5);
      }
    }
  });

  it("includes a deadline chore with a lead time", () => {
    expect(defaultChores().some((c) => c.deadlineDate !== null && c.leadTimeDays !== null)).toBe(true);
  });
});

describe("weekOneBonus", () => {
  it("multiplies points during the catch-up sprint", () => {
    expect(weekOneBonus(10)).toBeGreaterThan(10);
  });
});
