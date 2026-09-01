import { describe, expect, it } from "vitest";
import { eligible, snooze } from "./notification.js";
import type { ChoreInstance } from "../model/ChoreInstance.js";
import type { DomainCtx } from "../ctx.js";

const ctx: DomainCtx = { now: Date.parse("2026-09-01T09:00:00+12:00"), timeZone: "Pacific/Auckland" };
const HOUR = 3_600_000;

function inst(over: Partial<ChoreInstance> = {}): ChoreInstance {
  return {
    instanceId: "i1", choreId: "c1", dueAt: ctx.now - 2 * 86_400_000, overdueDays: 2,
    calendarEventId: null, lastNotifiedAt: null, snoozedUntil: null, ...over,
  };
}

describe("eligible", () => {
  it("alerts once for a newly overdue chore", () => {
    expect(eligible(ctx, inst(), { repeatEveryHours: null })).toBe(true);
  });

  it("does not alert again with repeat-nag off, however long it stays overdue", () => {
    expect(eligible(ctx, inst({ lastNotifiedAt: ctx.now - 500 * HOUR }), { repeatEveryHours: null })).toBe(false);
  });

  it("re-alerts only once the chosen interval has elapsed", () => {
    const policy = { repeatEveryHours: 48 };
    expect(eligible(ctx, inst({ lastNotifiedAt: ctx.now - 47 * HOUR }), policy)).toBe(false);
    expect(eligible(ctx, inst({ lastNotifiedAt: ctx.now - 49 * HOUR }), policy)).toBe(true);
  });

  it("stays silent while snoozed", () => {
    expect(eligible(ctx, inst({ snoozedUntil: ctx.now + 6 * HOUR }), { repeatEveryHours: null })).toBe(false);
  });

  it("is not eligible before the chore is overdue", () => {
    expect(eligible(ctx, inst({ dueAt: ctx.now + 86_400_000, overdueDays: 0 }), { repeatEveryHours: null })).toBe(false);
  });
});

describe("snooze", () => {
  it("sets snoozedUntil without touching the due date, so health keeps decaying", () => {
    const before = inst();
    const after = snooze(ctx, before, 12);
    expect(after.snoozedUntil).toBe(ctx.now + 12 * HOUR);
    expect(after.dueAt).toBe(before.dueAt);
    expect(after.overdueDays).toBe(before.overdueDays);
  });
});
