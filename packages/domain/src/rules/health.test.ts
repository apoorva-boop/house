import { describe, expect, it } from "vitest";
import { health, healthBand } from "./health.js";
import { DEFAULT_BUDGETS } from "../model/Asset.js";
import type { Asset } from "../model/Asset.js";
import type { Chore } from "../model/Chore.js";
import type { ChoreInstance } from "../model/ChoreInstance.js";
import type { DomainCtx } from "../ctx.js";

const ctx: DomainCtx = { now: Date.parse("2026-09-01T09:00:00+12:00"), timeZone: "Pacific/Auckland" };
const house: Asset = { id: "house", kind: "house", budget: DEFAULT_BUDGETS.house };
const garden: Asset = { id: "garden", kind: "garden", budget: DEFAULT_BUDGETS.garden };

function overdue(assetId: string, w: Chore["weight"], days: number, intervalDays = 30) {
  const chore: Chore = {
    id: `c-${assetId}-${days}`, title: "t", assetId, weight: w,
    recurrence: { kind: "interval", unit: "day", n: intervalDays },
    deadlineDate: null, leadTimeDays: null, urgencyCurve: null,
  };
  const instance: ChoreInstance = {
    instanceId: `i-${chore.id}`, choreId: chore.id,
    dueAt: ctx.now - days * 86_400_000, overdueDays: days,
    calendarEventId: null, lastNotifiedAt: null, snoozedUntil: null,
  };
  return { instance, chore };
}

describe("health", () => {
  it("never returns a negative value however large the backlog", () => {
    const huge = Array.from({ length: 200 }, (_, i) =>
      overdue("house", { time: 5, effort: 5, priority: 5 }, 300 + i));
    expect(health(ctx, house, huge)).toBe(0);
  });

  it("returns 100 with nothing overdue", () => {
    expect(health(ctx, house, [])).toBe(100);
  });

  it("bounds one small chore 400 days overdue so the house stays above 50", () => {
    // severity saturates at 1; the damage is weight/budget, not unbounded.
    // weight 7 (all-minimum sliders) against budget 60 costs ~11.7 health.
    const result = health(ctx, house, [overdue("house", { time: 1, effort: 1, priority: 1 }, 400)]);
    expect(result).toBeGreaterThan(50);
  });

  it("degrades visibly under several important overdue chores", () => {
    const several = [
      overdue("house", { time: 4, effort: 4, priority: 5 }, 60),
      overdue("house", { time: 5, effort: 4, priority: 5 }, 90),
      overdue("house", { time: 3, effort: 5, priority: 4 }, 45),
    ];
    expect(health(ctx, house, several)).toBeLessThan(60);
  });

  it("computes garden health independently of the house", () => {
    const gardenOverdue = [overdue("garden", { time: 4, effort: 4, priority: 4 }, 90)];
    expect(health(ctx, garden, gardenOverdue)).toBeLessThan(100);
    expect(health(ctx, house, [])).toBe(100);
  });
});

describe("healthBand", () => {
  it.each([
    [100, "immaculate"], [80, "immaculate"],
    [79, "dusty"], [60, "dusty"],
    [59, "grubby"], [40, "grubby"],
    [39, "damaged"], [20, "damaged"],
    [19, "broken-down"], [0, "broken-down"],
  ])("maps %i to %s", (value, band) => {
    expect(healthBand(value)).toBe(band);
  });
});
