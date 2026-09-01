import type { DomainCtx } from "../ctx.js";
import type { Asset } from "../model/Asset.js";
import type { Chore } from "../model/Chore.js";
import type { ChoreInstance } from "../model/ChoreInstance.js";
import type { Recurrence } from "../model/Recurrence.js";
import { weight } from "./weight.js";

export type HealthBand = "immaculate" | "dusty" | "grubby" | "damaged" | "broken-down";

/** One overdue chore and the instance that is late. The pair the health sum runs over. */
export interface OverdueChore {
  readonly instance: ChoreInstance;
  readonly chore: Chore;
}

const MS_PER_DAY = 86_400_000;

/**
 * How long a chore has to be late before it does all the damage it can.
 *
 * Floored at 14 days so a daily chore does not wreck the house the morning after it is
 * missed, and capped at 90 so an annual chore is not still shrugging it off a season
 * late. Both bounds are on the *cap*, not on the overdue count.
 */
const MIN_CAP_DAYS = 14;
const MAX_CAP_DAYS = 90;

/** The cap for a chore that is neither recurring nor deadline-bound. */
const FALLBACK_CAP_DAYS = MIN_CAP_DAYS;

// Calendar months and years vary in length, but capDays is clamped into [14, 90], so a
// monthly chore lands on 30 and anything quarterly or longer saturates the cap. Exact
// calendar arithmetic would not change a single answer here, and recurrence.ts already
// owns the place where it does matter.
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

function intervalDaysOf(recurrence: Recurrence): number {
  if (recurrence.kind === "timesPerYear") {
    const times = Math.max(1, Math.trunc(recurrence.timesPerYear));
    return DAYS_PER_YEAR / times;
  }
  const n = Math.max(1, Math.trunc(recurrence.n));
  switch (recurrence.unit) {
    case "day":
      return n;
    case "week":
      return n * 7;
    case "month":
      return n * DAYS_PER_MONTH;
    case "year":
      return n * DAYS_PER_YEAR;
  }
}

/**
 * The number of days of lateness at which this chore's severity reaches 1.
 *
 * A recurring chore is judged against its own interval, clamped. A deadline chore is
 * judged against its lead time: a warrant of fitness booked six weeks out is fully bad
 * six weeks after the deadline, whatever the house's other chores look like.
 *
 * A non-finite or non-positive cap would make severity `NaN` or `Infinity`, which then
 * poisons the whole asset's health. A malformed row falls back to the 14-day floor
 * instead — visible damage rather than a broken number.
 */
export function capDays(chore: Chore): number {
  if (chore.recurrence !== null) {
    const raw = intervalDaysOf(chore.recurrence);
    if (!Number.isFinite(raw)) return FALLBACK_CAP_DAYS;
    return Math.min(Math.max(raw, MIN_CAP_DAYS), MAX_CAP_DAYS);
  }
  const lead = chore.leadTimeDays;
  if (lead === null || !Number.isFinite(lead) || lead <= 0) return FALLBACK_CAP_DAYS;
  return lead;
}

/**
 * How late this instance is, in days, read off `ctx` rather than off the stored field.
 *
 * `instance.overdueDays` is a snapshot the server wrote when it last swept; `ctx.now`
 * is the clock this call is being made at. Reading the clock keeps health moving between
 * sweeps, and keeps the whole package testable at a fixed instant. The stored value is
 * the fallback for a row whose `dueAt` is unreadable.
 */
function overdueDaysOf(ctx: DomainCtx, instance: ChoreInstance): number {
  if (!Number.isFinite(ctx.now) || !Number.isFinite(instance.dueAt)) {
    return Number.isFinite(instance.overdueDays) ? Math.max(0, instance.overdueDays) : 0;
  }
  return Math.max(0, (ctx.now - instance.dueAt) / MS_PER_DAY);
}

/** 0 when the chore has just come due, 1 once it has been late for its whole cap. */
export function severity(ctx: DomainCtx, entry: OverdueChore): number {
  return Math.min(1, overdueDaysOf(ctx, entry.instance) / capDays(entry.chore));
}

/**
 * What this one overdue chore costs the asset it belongs to: its points, scaled down
 * while it is only a little bit late.
 */
export function burden(ctx: DomainCtx, entry: OverdueChore): number {
  return weight(entry.chore.weight) * severity(ctx, entry);
}

/**
 * How good `asset` looks, 0 to 100.
 *
 * `health = max(0, 100 - 100 * Sum(burden) / asset.budget)`. The budget is how much
 * accumulated burden takes an asset all the way to rock bottom — 60 for the house, 25
 * for the garden, 30 for the car — which is why the garden looks bad on far less
 * neglect than the house does.
 *
 * Severity saturating at 1 is what stops the arithmetic running away: one small chore
 * left for four hundred days costs its 7 points and no more, so the house stays in the
 * eighties. It takes a *backlog* to break the house, not one forgotten job.
 *
 * Entries belonging to another asset are ignored, so a caller may pass the whole overdue
 * list without slicing it per asset first. That is what keeps the garden's condition
 * independent of the house's.
 *
 * The result is rounded to a whole number so the value shown to a person and the band
 * drawn on the map can never disagree at a boundary.
 */
export function health(ctx: DomainCtx, asset: Asset, overdue: readonly OverdueChore[]): number {
  const budget = Number.isFinite(asset.budget) && asset.budget > 0 ? asset.budget : 1;
  let total = 0;
  for (const entry of overdue) {
    if (entry.chore.assetId !== asset.id) continue;
    total += burden(ctx, entry);
  }
  return Math.max(0, Math.round(100 - (100 * total) / budget));
}

/**
 * The five visual steps. Bands are half-open upwards from their floor, so 80 is
 * immaculate and 79 is dusty — the boundaries the art assets are cut against.
 *
 * A non-finite input reads as broken-down: if the number is unreadable, showing the
 * house as filthy is the failure that gets looked at, and showing it as immaculate is
 * the one that does not.
 */
export function healthBand(value: number): HealthBand {
  if (!Number.isFinite(value)) return "broken-down";
  if (value >= 80) return "immaculate";
  if (value >= 60) return "dusty";
  if (value >= 40) return "grubby";
  if (value >= 20) return "damaged";
  return "broken-down";
}
