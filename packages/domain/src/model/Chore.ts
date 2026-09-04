import type { Recurrence } from "./Recurrence.js";

/** Sliders are integers on a 1-5 domain. */
export interface ChoreWeight {
  readonly time: number;
  readonly effort: number;
  readonly priority: number;
}

export interface Chore {
  readonly id: string;
  readonly title: string;
  readonly assetId: string;
  readonly weight: ChoreWeight;
  readonly recurrence: Recurrence | null;
  readonly deadlineDate: string | null;
  readonly leadTimeDays: number | null;
  readonly urgencyCurve: "linear" | "steep" | null;
}
