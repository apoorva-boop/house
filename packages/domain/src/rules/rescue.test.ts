import { describe, expect, it } from "vitest";
import { rescue } from "./rescue.js";
import type { Chore } from "../model/Chore.js";
import type { ChoreInstance } from "../model/ChoreInstance.js";
import type { DomainCtx } from "../ctx.js";

const ctx: DomainCtx = { now: Date.parse("2026-09-01T09:00:00+12:00"), timeZone: "Pacific/Auckland" };

function pair(id: string, priority: number, effort: number) {
  const chore: Chore = {
    id, title: id, assetId: "house", weight: { time: 2, effort, priority },
    recurrence: { kind: "interval", unit: "day", n: 30 },
    deadlineDate: null, leadTimeDays: null, urgencyCurve: null,
  };
  const instance: ChoreInstance = {
    instanceId: `i-${id}`, choreId: id, dueAt: ctx.now - 40 * 86_400_000, overdueDays: 40,
    calendarEventId: null, lastNotifiedAt: null, snoozedUntil: null,
  };
  return { instance, chore };
}

describe("rescue", () => {
  it("reports the overdue count and exactly one recommendation at rock bottom", () => {
    const r = rescue(ctx, [pair("gutters", 5, 4), pair("bins", 2, 1), pair("wof", 5, 2)]);
    expect(r.overdueCount).toBe(3);
    expect(r.recommended).not.toBeNull();
  });

  it("recommends the best burden-per-effort chore, not merely the highest priority", () => {
    const r = rescue(ctx, [pair("gutters", 5, 5), pair("wof", 5, 1)]);
    expect(r.recommended?.id).toBe("wof");
  });

  it("awards week-one bonus points", () => {
    expect(rescue(ctx, [pair("gutters", 5, 4)]).bonusPoints).toBeGreaterThan(0);
  });

  it("has nothing to recommend when nothing is overdue", () => {
    const r = rescue(ctx, []);
    expect(r.overdueCount).toBe(0);
    expect(r.recommended).toBeNull();
  });
});
