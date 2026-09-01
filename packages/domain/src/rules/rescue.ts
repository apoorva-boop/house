import type { DomainCtx } from "../ctx.js";
import type { Chore } from "../model/Chore.js";
import { weekOneBonus } from "../seed/defaultChores.js";
import { burden, type OverdueChore } from "./health.js";
import { weight } from "./weight.js";

export interface Rescue {
  /** How many chores are late. The number the rescue screen leads with. */
  readonly overdueCount: number;
  /** The one chore to do next, or `null` when nothing is overdue. */
  readonly recommended: Chore | null;
  /** Extra points on offer across the backlog during the catch-up sprint. */
  readonly bonusPoints: number;
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
 */
export function rescue(ctx: DomainCtx, overdue: readonly OverdueChore[]): Rescue {
  let best: OverdueChore | null = null;
  let bestScore = -Infinity;
  let bestBurden = -Infinity;
  let bonusPoints = 0;

  for (const entry of overdue) {
    const b = burden(ctx, entry);
    const score = b / effortOf(entry.chore);

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

  return { overdueCount: overdue.length, recommended: best?.chore ?? null, bonusPoints };
}
