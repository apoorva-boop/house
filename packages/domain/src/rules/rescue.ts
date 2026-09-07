import type { DomainCtx } from "../ctx.js";
import type { Chore } from "../model/Chore.js";
import { weekOneBonus } from "../seed/defaultChores.js";
import { burden, hasReadableWeight, isOverdue, type OverdueChore } from "./health.js";
import { weight } from "./weight.js";

export interface Rescue {
  /** How many chores are late. The number the rescue screen leads with. */
  readonly overdueCount: number;
  /** The one chore to do next, or `null` when nothing is overdue. */
  readonly recommended: Chore | null;
  /** Extra points on offer across the backlog during the catch-up sprint. */
  readonly bonusPoints: number;
  /**
   * Ids of overdue chores whose sliders were unreadable, so they could not be scored or
   * recommended. They are still inside `overdueCount` — an unreadable row is still a late
   * job — but they contributed no `bonusPoints` and can never be `recommended`. Non-empty
   * means the screen should say some rows need fixing rather than pretend they scored 0.
   */
  readonly skipped: readonly string[];
}

/** Effort is a 1-5 slider; anything outside that is a bad row, not a free chore. */
function effortOf(chore: Chore): number {
  const e = chore.weight.effort;
  return Number.isFinite(e) ? Math.min(5, Math.max(1, e)) : 3;
}

/**
 * What to show when the house has hit rock bottom.
 *
 * At health 19 or below the normal list is the problem: twenty overdue chores is not a
 * to-do list, it is a reason to close the app. So the rescue screen shows the size of
 * the hole, exactly *one* thing to do about it, and what the week is paying.
 *
 * The recommendation is the best **burden per unit of effort** — the chore that buys back
 * the most condition for the least work — not simply the most important one. Those come
 * apart in practice: gutters at priority 5 and effort 5 return 5.8 points of condition
 * per unit of effort, while a warrant at the same priority and effort 1 returns 21. Both
 * matter; only one of them is a sensible first move for somebody who has already given
 * up once. Priority still dominates, because it is weighted heaviest inside `weight()` —
 * it just no longer wins on its own.
 *
 * Ties break towards the larger raw burden, then the lower id, so two people looking at
 * the same house are told the same thing.
 *
 * This rule does not decide *whether* the house is at rock bottom — `healthBand` does.
 * The caller shows this screen when the band is "broken-down".
 *
 * **Input contract: this function does not filter by asset, and it filters by lateness.**
 * Spanning every asset is deliberate — when somebody has given up, the best next move is
 * the best next move on the whole property, not the best one on the house. That is the
 * opposite of `health()`, which slices the same list down to one asset. Entries that are
 * not yet due are dropped entirely: they are not part of the backlog, so they are neither
 * counted, recommended, nor paid a bonus. Rows with unreadable sliders are counted but not
 * scored, and are listed in `skipped`.
 */
export function rescue(ctx: DomainCtx, overdue: readonly OverdueChore[]): Rescue {
  let best: OverdueChore | null = null;
  let bestScore = -Infinity;
  let bestBurden = -Infinity;
  let bonusPoints = 0;
  let overdueCount = 0;
  const skipped: string[] = [];

  for (const entry of overdue) {
    if (!isOverdue(ctx, entry.instance)) continue;
    overdueCount += 1;

    const b = burden(ctx, entry);
    const score = b / effortOf(entry.chore);

    // A `NaN` score must never reach the comparison below. `NaN > bestScore` is false, so
    // the first bad row would be adopted as `best` and then win forever, because every
    // later `score > NaN` is false too: the malformed chore would be the recommendation.
    if (!hasReadableWeight(entry.chore) || !Number.isFinite(score)) {
      skipped.push(entry.chore.id);
      continue;
    }

    const better =
      score > bestScore ||
      (score === bestScore && b > bestBurden) ||
      (score === bestScore && b === bestBurden && best !== null && entry.chore.id < best.chore.id);
    if (best === null || better) {
      best = entry;
      bestScore = score;
      bestBurden = b;
    }

    const base = weight(entry.chore.weight);
    bonusPoints += weekOneBonus(base) - base;
  }

  return { overdueCount, recommended: best?.chore ?? null, bonusPoints, skipped };
}
