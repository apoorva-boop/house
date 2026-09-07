export type RecurrenceUnit = "day" | "week" | "month" | "year";
export type Recurrence =
  | { readonly kind: "interval"; readonly unit: RecurrenceUnit; readonly n: number }
  | { readonly kind: "timesPerYear"; readonly timesPerYear: number };
