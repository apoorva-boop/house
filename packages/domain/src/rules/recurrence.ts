import type { DomainCtx } from "../ctx.js";
import type { Chore } from "../model/Chore.js";
// STUB — phase 3.
export function nextDueFrom(_ctx: DomainCtx, _lastDone: number, _chore: Chore): number { return 0; }
export function advanceOnCompletion(_ctx: DomainCtx, _chore: Chore, _completedAt: number): Chore { return _chore; }
