export type AssetKind = "house" | "garden" | "car";

export interface Asset {
  readonly id: string;
  readonly kind: AssetKind;
  readonly budget: number;
}

export const DEFAULT_BUDGETS: Record<AssetKind, number> = { house: 60, garden: 25, car: 30 };
