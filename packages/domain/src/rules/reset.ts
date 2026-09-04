export type ResetState = "none" | "proposed" | "approved" | "declined";

export interface ResetProposal {
  readonly state: ResetState;
  readonly proposedBy: string | null;
}

/** Nothing on the table. The state a fresh house starts in. */
export const NO_RESET: ResetProposal = { state: "none", proposedBy: null };

/**
 * One person asks for the character scores to be wiped.
 *
 * A reset exists because the scoreboard is meant to prompt a conversation, not keep a
 * grudge: after an illness or a fortnight away, one person's share is wrong in a way no
 * amount of catching up fixes quickly. Wiping it is cheap; arguing about it is not.
 */
export function propose(by: string): ResetProposal {
  return { state: "proposed", proposedBy: by };
}

/**
 * The other person agrees.
 *
 * The proposer cannot approve their own proposal — that is the whole point of the two
 * steps, and it is why this returns the proposal unchanged rather than throwing: the
 * caller is a UI that may well offer the button to whoever is looking, and a no-op is a
 * button that does nothing, not a crash.
 *
 * Anything not currently `proposed` is also returned untouched, so a double-tap or a
 * replayed mutation cannot approve an already-settled proposal a second time.
 *
 * Approval clears the character scores only. Completions are history and are never
 * deleted: the points stop counting towards anybody's share, the record of who did what
 * stays. Performing that wipe is the caller's job — this rule owns the handshake.
 */
export function approve(p: ResetProposal, by: string): ResetProposal {
  if (p.state !== "proposed") return p;
  if (p.proposedBy === by) return p;
  return { state: "approved", proposedBy: p.proposedBy };
}

/**
 * The proposal is turned down and the scores stand.
 *
 * Unlike `approve`, the proposer may decline their own proposal: withdrawing something
 * you asked for needs no second signature.
 */
export function decline(p: ResetProposal, _by: string): ResetProposal {
  if (p.state !== "proposed") return p;
  return { state: "declined", proposedBy: p.proposedBy };
}
