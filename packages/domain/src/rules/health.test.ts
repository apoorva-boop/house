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

  it("scores each asset off ONE mixed list, ignoring the other asset's overdue chores", () => {
    // The filter inside healthReport is the only thing keeping these two numbers apart.
    // One list, handed whole to both calls, is what exercises it: a per-asset list would
    // give the same answers with the filter deleted.
    const gardenEntry = overdue("garden", { time: 1, effort: 1, priority: 1 }, 90); // weight 7
    const houseEntry = overdue("house", { time: 5, effort: 5, priority: 5 }, 90); // weight 35
    const mixed = [gardenEntry, houseEntry];

    // Both are 90 days late against a 30-day interval, so severity saturates at 1 and
    // burden is just the weight. Garden budget 25: 100 - 100*7/25 = 72.
    // House budget 60: 100 - 100*35/60 = 41.67 -> 42.
    expect(health(ctx, garden, mixed)).toBe(72);
    expect(health(ctx, house, mixed)).toBe(42);

    // And the mixed list must give the same answer as the sliced one, both ways round.
    expect(health(ctx, garden, mixed)).toBe(health(ctx, garden, [gardenEntry]));
    expect(health(ctx, house, mixed)).toBe(health(ctx, house, [houseEntry]));
  });

  it("clamps capDays up to the 14-day floor for a chore due more often than that", () => {
    // Daily chore, 7 days late. Raw interval 1 would saturate severity at 1 and cost the
    // full 35 points; the 14-day floor makes it severity 0.5 and half the damage.
    // 100 - 100*(35*0.5)/60 = 70.83 -> 71. Unclamped it would be 42.
    const daily = overdue("house", { time: 5, effort: 5, priority: 5 }, 7, 1);
    expect(health(ctx, house, [daily])).toBe(71);
    expect(health(ctx, house, [daily])).not.toBe(42);
  });

  it("clamps capDays down to the 90-day ceiling for a chore due less often than that", () => {
    // Annual chore, 180 days late. Raw interval 365 would leave severity at 0.49 and only
    // 17.3 points of damage; the 90-day ceiling saturates it at 1 for the full 35.
    // 100 - 100*35/60 = 41.67 -> 42. Unclamped it would be 71.
    const annual = overdue("house", { time: 5, effort: 5, priority: 5 }, 180, 365);
    expect(health(ctx, house, [annual])).toBe(42);
    expect(health(ctx, house, [annual])).not.toBe(71);
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
