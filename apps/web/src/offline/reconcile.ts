// STUB - phase 3. Returns `base` untouched: the queue is supposed to be replayed on
// top of the server snapshot, but nothing is replayed yet. A test that ticks a chore
// and expects the optimistic completion to appear fails on that assertion, not because
// the function is missing.
import type { DomainCtx } from "@house/domain";
import type { Household } from "../model/Household.js";
import type { QueuedMutation } from "./MutationQueue.js";

/**
 * The queue IS the optimistic state. Replay it on top of the server snapshot.
 * A completion already present on the server under the same mutationId is kept once,
 * not twice — that is the "skip any row whose mutationId is still in the queue" rule.
 */
export function applyPending(
  ctx: DomainCtx,
  base: Household,
  queued: readonly QueuedMutation[],
  personId: string,
): Household {
  void ctx;
  void queued;
  void personId;
  return base;
}
