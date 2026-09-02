import { describe, expect, it } from "vitest";
import { fairness } from "./fairness.js";
import type { Completion } from "../model/Completion.js";
import type { DomainCtx } from "../ctx.js";

const ctx: DomainCtx = { now: Date.parse("2026-09-01T09:00:00+12:00"), timeZone: "Pacific/Auckland" };
const PEOPLE = ["apoorva", "friend"];
const DAY = 86_400_000;

function done(personId: string, points: number, daysAgo: number): Completion {
  return {
    mutationId: `m-${personId}-${points}-${daysAgo}`, instanceId: `i-${daysAgo}`,
    choreId: `c-${daysAgo}`, personId, completedAt: ctx.now - daysAgo * DAY,
    pointsAwarded: points, choreTitle: "t", assetId: "house",
  };
}

describe("fairness", () => {
  it("is neutral for both people when nothing has been done", () => {
    const r = fairness(ctx, [], PEOPLE);
    expect(r.windowPoints).toBe(0);
    expect(r.byPerson["apoorva"]?.tier).toBe(0);
    expect(r.byPerson["friend"]?.tier).toBe(0);
  });

  it("damps a single 5-point completion to the 0.2 tier, not 0.8", () => {
    // share 1, overload 1, confidence 5/20 = 0.25, effectiveOverload 0.25 -> tier 0.2
    const r = fairness(ctx, [done("friend", 5, 3)], PEOPLE);
    expect(r.byPerson["friend"]?.effectiveOverload).toBeCloseTo(0.25, 5);
    expect(r.byPerson["friend"]?.tier).toBe(0.2);
  });

  it("puts the carrier at tier >= 0.6 at an 80/20 split once windowPoints >= 20", () => {
    const completions = [
      done("friend", 20, 2), done("friend", 20, 5), done("friend", 20, 9), done("friend", 20, 14),
      done("apoorva", 20, 7),
    ];
    const r = fairness(ctx, completions, PEOPLE);
    expect(r.windowPoints).toBe(100);
    expect(r.byPerson["friend"]?.share).toBeCloseTo(0.8, 5);
    expect(r.byPerson["friend"]?.tier).toBeGreaterThanOrEqual(0.6);
  });

  it("leaves the under-contributing person unexhausted", () => {
    const r = fairness(ctx, [done("friend", 40, 2), done("apoorva", 10, 3)], PEOPLE);
    expect(r.byPerson["apoorva"]?.effectiveOverload).toBe(0);
  });

  it("excludes a completion 31 days old and includes one 29 days old", () => {
    expect(fairness(ctx, [done("friend", 25, 31)], PEOPLE).windowPoints).toBe(0);
    expect(fairness(ctx, [done("friend", 25, 29)], PEOPLE).windowPoints).toBe(25);
  });

  it("ignores a completion by somebody outside the household, windowPoints included", () => {
    // Decided behaviour: points earned by a person who is not on screen are dropped
    // entirely rather than counted into the denominator. Counting them would deflate
    // both real shares against points nobody can be credited with.
    const household = [done("friend", 20, 2), done("apoorva", 20, 3)];
    const withGuest = [...household, done("houseguest", 60, 4)];

    const r = fairness(ctx, withGuest, PEOPLE);
    expect(r.windowPoints).toBe(40);
    expect(r.byPerson["friend"]?.points).toBe(20);
    expect(r.byPerson["apoorva"]?.points).toBe(20);
    expect(r.byPerson["friend"]?.share).toBeCloseTo(0.5, 5);
    expect(r.byPerson["apoorva"]?.share).toBeCloseTo(0.5, 5);
    expect(r.byPerson["houseguest"]).toBeUndefined();

    // The guest changes nothing at all: same result as if they had never completed it.
    expect(r).toEqual(fairness(ctx, household, PEOPLE));
  });
});
