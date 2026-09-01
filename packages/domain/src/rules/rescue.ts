import type { DomainCtx } from "../ctx.js";
import type { Chore } from "../model/Chore.js";
import type { ChoreInstance } from "../model/ChoreInstance.js";

export interface Rescue { readonly overdueCount: number; readonly recommended: Chore | null; readonly bonusPoints: number; }

// STUB — phase 3.
export function rescue(_ctx: DomainCtx, _o: ReadonlyArray<{ instance: ChoreInstance; chore: Chore }>): Rescue {
  return { overdueCount: NaN, recommended: undefined as unknown as Chore, bonusPoints: NaN };
}
