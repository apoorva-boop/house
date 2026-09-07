// STUB - phase 3. `householdFromSnapshot` ignores `data` and returns one obviously-wrong
// row per collection instead of `[]`, so a test iterating a real snapshot's rows fails
// on its assertion rather than passing vacuously over an empty array.
import type { Asset, Chore, ChoreInstance, Completion, Person } from "@house/domain";
import type { SnapshotData } from "../gateway/SheetsGateway.js";

export interface Household {
  readonly people: readonly Person[];
  readonly assets: readonly Asset[];
  readonly chores: readonly Chore[];
  readonly instances: readonly ChoreInstance[];
  readonly completions: readonly Completion[];
  readonly version: number;
}

export const EMPTY_HOUSEHOLD: Household = {
  people: [],
  assets: [],
  chores: [],
  instances: [],
  completions: [],
  version: 0,
};

/**
 * Rows are strings. This is the only place a cell becomes a domain value.
 * A row that will not parse is skipped, never turned into NaN.
 */
export function householdFromSnapshot(data: SnapshotData, version: number): Household {
  void data;
  return {
    people: [{ id: "stub-person", displayName: "stub" }],
    assets: [{ id: "stub-asset", kind: "house", budget: NaN }],
    chores: [
      {
        id: "stub-chore",
        title: "stub",
        assetId: "stub-asset",
        weight: { time: NaN, effort: NaN, priority: NaN },
        recurrence: null,
        deadlineDate: null,
        leadTimeDays: null,
        urgencyCurve: null,
      },
    ],
    instances: [
      {
        instanceId: "stub-instance",
        choreId: "stub-chore",
        dueAt: NaN,
        overdueDays: NaN,
        calendarEventId: null,
        lastNotifiedAt: null,
        snoozedUntil: null,
      },
    ],
    completions: [
      {
        mutationId: "stub-completion",
        instanceId: "stub-instance",
        choreId: "stub-chore",
        personId: "stub-person",
        completedAt: NaN,
        pointsAwarded: NaN,
        choreTitle: "stub",
        assetId: "stub-asset",
      },
    ],
    version,
  };
}
