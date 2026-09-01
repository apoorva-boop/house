import type { DomainCtx } from "../ctx.js";
import type { ChoreInstance } from "../model/ChoreInstance.js";

export interface NotifyPolicy { readonly repeatEveryHours: number | null; }

// STUB — phase 3.
export function eligible(_ctx: DomainCtx, _i: ChoreInstance, _p: NotifyPolicy): boolean { return undefined as unknown as boolean; }
export function snooze(_ctx: DomainCtx, i: ChoreInstance, _hours: number): ChoreInstance { return { ...i, snoozedUntil: NaN, dueAt: NaN, overdueDays: NaN }; }
