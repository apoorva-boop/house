import type { DomainCtx } from "../ctx.js";
import type { Completion } from "../model/Completion.js";

export interface FairnessResult {
  readonly windowPoints: number;
  readonly byPerson: Readonly<Record<string, { share: number; effectiveOverload: number; tier: number }>>;
}

// STUB — phase 3.
export function fairness(_ctx: DomainCtx, _completions: readonly Completion[], _personIds: readonly string[]): FairnessResult {
  return { windowPoints: NaN, byPerson: {} };
}
