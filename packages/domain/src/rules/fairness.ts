import type { DomainCtx } from "../ctx.js";
import type { Completion } from "../model/Completion.js";

/** One person's standing over the window. */
export interface PersonFairness {
  /** This person's fraction of the window's points, 0 to 1. */
  readonly share: number;
  /** Raw over-carrying: 0 at an even split, 1 at doing everything. */
  readonly overload: number;
  /** Points this person earned inside the window. */
  readonly points: number;
  /** `overload` damped by how much evidence the window actually holds. */
  readonly effectiveOverload: number;
  /** The drawn exhaustion step: one of 0, 0.2, 0.4, 0.6, 0.8. */
  readonly tier: number;
}

export interface FairnessResult {
  readonly windowPoints: number;
  readonly byPerson: Readonly<Record<string, PersonFairness>>;
}

const MS_PER_DAY = 86_400_000;

/** The rolling window. Long enough to cover a monthly chore, short enough to feel current. */
export const WINDOW_DAYS = 30;

/**
 * The point count at which the window is trusted completely. Below it, the split is
 * still noise: one person doing the only chore of the fortnight is not evidence that
 * they are carrying the house.
 */
const FULL_CONFIDENCE_POINTS = 20;

/** An even split between two people. Share above this is over-carrying. */
const EVEN_SHARE = 0.5;

/** The five drawn exhaustion steps. */
export const TIERS: readonly number[] = [0, 0.2, 0.4, 0.6, 0.8];

/** Floating-point slack, so 0.6000000000000001 does not fall back to the 0.4 tier. */
const TIER_EPSILON = 1e-9;

function tierFor(effectiveOverload: number): number {
  let found = TIERS[0] ?? 0;
  for (const t of TIERS) {
    if (effectiveOverload + TIER_EPSILON >= t) found = t;
  }
  return found;
}

/**
 * Who is carrying the house over the last 30 days, and how hard it shows.
 *
 * Three deliberate choices, all of them about not accusing anybody unfairly:
 *
 * 1. **An empty window is neutral.** No completions means no evidence, not a tie broken
 *    arbitrarily. Both people come back at tier 0.
 * 2. **Confidence damping.** `effectiveOverload = overload * min(1, windowPoints/20)`.
 *    A single five-point chore is a 100% share on paper; damped, it lands at 0.25 and
 *    draws the second tier, not the top one. The character only looks wrecked once
 *    there is a month of work behind the claim.
 * 3. **Only over-carrying is shown.** `overload` floors at 0, so the person doing less
 *    is never drawn as tired and never labelled. The rule answers "is somebody carrying
 *    too much", not "who is slacking" — the second question is one a shared house does
 *    not need a computer's opinion on.
 *
 * Completions by a person not in `personIds` are ignored entirely, including in
 * `windowPoints`. Counting them would deflate both real shares against points nobody on
 * screen can be credited with.
 */
export function fairness(
  ctx: DomainCtx,
  completions: readonly Completion[],
  personIds: readonly string[],
): FairnessResult {
  const cutoff = ctx.now - WINDOW_DAYS * MS_PER_DAY;
  const known = new Set(personIds);

  const points = new Map<string, number>();
  for (const id of personIds) points.set(id, 0);

  let windowPoints = 0;
  for (const c of completions) {
    if (!known.has(c.personId)) continue;
    if (!Number.isFinite(c.completedAt) || c.completedAt < cutoff) continue;
    const earned = Number.isFinite(c.pointsAwarded) ? Math.max(0, c.pointsAwarded) : 0;
    points.set(c.personId, (points.get(c.personId) ?? 0) + earned);
    windowPoints += earned;
  }

  const confidence = windowPoints > 0 ? Math.min(1, windowPoints / FULL_CONFIDENCE_POINTS) : 0;

  const byPerson: Record<string, PersonFairness> = {};
  for (const id of personIds) {
    const personPoints = points.get(id) ?? 0;
    const share = windowPoints > 0 ? personPoints / windowPoints : 0;
    const overload = windowPoints > 0 ? Math.max(0, share / EVEN_SHARE - 1) : 0;
    const effectiveOverload = overload * confidence;
    byPerson[id] = { share, overload, points: personPoints, effectiveOverload, tier: tierFor(effectiveOverload) };
  }

  return { windowPoints, byPerson };
}
