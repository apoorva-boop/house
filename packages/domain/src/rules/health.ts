import type { DomainCtx } from "../ctx.js";
import type { Asset } from "../model/Asset.js";
import type { Chore } from "../model/Chore.js";
import type { ChoreInstance } from "../model/ChoreInstance.js";

export type HealthBand = "immaculate" | "dusty" | "grubby" | "damaged" | "broken-down";

// STUB — phase 3.
export function health(_ctx: DomainCtx, _asset: Asset, _overdue: ReadonlyArray<{ instance: ChoreInstance; chore: Chore }>): number { return NaN; }
export function healthBand(_health: number): HealthBand { return "UNSET" as HealthBand; }
