import type { Chore } from "../model/Chore.js";

// STUB - phase 3. Returns ONE chore with an out-of-range slider rather than an empty
// array: an empty array makes every `for (const c of chores)` assertion pass vacuously,
// which is a green that proves nothing.
export function defaultChores(): Chore[] {
  return [{
    id: "stub", title: "stub", assetId: "nowhere",
    weight: { time: 99, effort: 99, priority: 99 },
    recurrence: null, deadlineDate: null, leadTimeDays: null, urgencyCurve: null,
  }];
}
export function weekOneBonus(_points: number): number { return NaN; }
