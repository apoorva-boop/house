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

/** True once `ctx.now` has passed the instance's due date. A chore due tomorrow is not late. */
export function isOverdue(ctx: DomainCtx, instance: ChoreInstance): boolean {
  return overdueDaysOf(ctx, instance) > 0;
}

/**
 * Whether all three sliders are readable numbers.
 *
 * `weight()` does arithmetic on the three sliders and clamps the result, but a clamp does
 * not rescue a `NaN` — `Math.min(35, Math.max(5, NaN))` is still `NaN`. The sliders arrive
 * from a spreadsheet cell through `Number(...)`, so a typo in a slider column reaches here
 * as `NaN` and would otherwise turn a whole asset's condition into "NaN" on the screen.
 *
 * This is the only unguarded input left in the scoring path: `capDays`, `overdueDaysOf`
 * and `asset.budget` all already fall back. Health and rescue are render paths, so they
 * skip the offending chore rather than throwing the way `recurrence.ts` does — one
 * unreadable row must not blank the map. Both report what they skipped so the caller can
 * say so out loud instead of quietly under-reporting the backlog.
 */
export function hasReadableWeight(chore: Chore): boolean {
  const w = chore.weight;
  return Number.isFinite(w.time) && Number.isFinite(w.effort) && Number.isFinite(w.priority);
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
 * **Input contract: this function filters.** Entries belonging to another asset are
 * ignored, so a caller may hand it the whole overdue list without slicing it per asset
 * first. That is what keeps the garden's condition independent of the house's. Note that
 * `rescue()` in this package does the opposite on purpose — it spans every asset — so do
 * not assume the two take the same list for the same reason.
 *
 * A chore whose sliders are unreadable is skipped rather than scored, which means the
 * number can understate the backlog. Use `healthReport` when you need to know that it did.
 *
 * The result is rounded to a whole number so the value shown to a person and the band
 * drawn on the map can never disagree at a boundary.
 */
export function health(ctx: DomainCtx, asset: Asset, overdue: readonly OverdueChore[]): number {
  return healthReport(ctx, asset, overdue).value;
}

/** `health` plus the ids of the chores it could not read. See `hasReadableWeight`. */
export interface HealthReport {
  /** The 0-100 condition score, over the chores that could be scored. */
  readonly value: number;
  /**
   * Ids of chores on this asset whose sliders were unreadable, so they are missing from
   * `value`. Non-empty means the score understates the backlog and the screen should say
   * so — an empty array is the normal case.
   */
  readonly skipped: readonly string[];
}

/**
 * `health()`, plus the chores it had to leave out.
 *
 * Same arithmetic and the same asset filter; the only difference is that this one hands
 * back the unreadable rows instead of dropping them silently. Callers that render a number
 * to a person should use this and surface `skipped`.
 */
export function healthReport(ctx: DomainCtx, asset: Asset, overdue: readonly OverdueChore[]): HealthReport {
  const budget = Number.isFinite(asset.budget) && asset.budget > 0 ? asset.budget : 1;
  const skipped: string[] = [];
  let total = 0;
  for (const entry of overdue) {
    if (entry.chore.assetId !== asset.id) continue;
    if (!hasReadableWeight(entry.chore)) {
      skipped.push(entry.chore.id);
      continue;
    }
    total += burden(ctx, entry);
  }
  return { value: Math.max(0, Math.round(100 - (100 * total) / budget)), skipped };
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
