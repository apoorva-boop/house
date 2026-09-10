// The one place a spreadsheet cell becomes a domain value. Mirrors the conventions in
// apps-script/src/Records.ts (and the small value helpers in apps-script/src/Config.ts):
// asText_/asNumber_/parseIso_ and recurrenceFromRow_'s discriminant-plus-guard shape.
//
// Two differences from the server, both because this file has no clock and no lock:
//   - `Records.ts`'s `instanceFromRow_` falls an unreadable `dueAt` back to `nowMs`. This
//     file has no `now` to fall back to, so an instance whose `dueAt` will not parse is
//     skipped entirely rather than guessed at.
//   - Weight sliders, `leadTimeDays` and `recurrenceN` keep the server's fallback-not-NaN
//     behaviour (a bad cell becomes a sane default), because `weight()` and `capDays()`
//     already assume finite numbers. `packages/domain/src/rules/health.ts`'s
//     `hasReadableWeight` guard exists for a `Chore` built some other way (see
//     `reconcile.ts`'s `chore.create`/`chore.update` replay) and is defence in depth here,
//     not the primary mechanism.
import type { Asset, AssetKind, Chore, ChoreInstance, Completion, Person, Recurrence } from "@house/domain";
import { DEFAULT_BUDGETS } from "@house/domain";
import type { Row, SnapshotData } from "../gateway/SheetsGateway.js";

export interface Household {
  readonly people: readonly Person[];
  readonly assets: readonly Asset[];
  readonly chores: readonly Chore[];
  readonly instances: readonly ChoreInstance[];
  readonly completions: readonly Completion[];
  /**
   * `Chores.nextDueAt`, in epoch millis, keyed by chore id. A missing key means the
   * chore has no next date at all — the blank the server writes for a warrant of fitness
   * once it is done, which `runDueSweep_` reads as "nobody has scheduled this".
   *
   * It lives beside the chores rather than on them because the domain's `Chore` type
   * carries no due date and must not gain one: a `Chore` is recurrence configuration,
   * and when an occurrence falls due is a `ChoreInstance`. But `Instances` holds only
   * occurrences the sweep has already materialised, so between "the date is set" and
   * "the sweep has run" there is no instance and the date lives only in this column.
   * Dropping it would render every not-yet-materialised chore as unscheduled.
   */
  readonly nextDueAt: Readonly<Record<string, number>>;
  readonly version: number;
}

export const EMPTY_HOUSEHOLD: Household = {
  people: [],
  assets: [],
  chores: [],
  instances: [],
  completions: [],
  nextDueAt: {},
  version: 0,
};

/**
 * When this chore is next due, according to whichever source knows.
 *
 * The open instance wins: the sweep materialised it, and Google Calendar may since have
 * moved it, which is authoritative. Falling back to the `Chores.nextDueAt` column covers
 * the gap before the sweep has run. `null` is a chore nothing has scheduled.
 */
export function effectiveDueAt(household: Household, choreId: string): number | null {
  const open = household.instances.find((i) => i.choreId === choreId);
  if (open !== undefined) return open.dueAt;
  return household.nextDueAt[choreId] ?? null;
}

// ---------------------------------------------------------------------------
// Small value helpers — exact mirror of Config.ts's asText_/asNumber_/parseIso_.
// ---------------------------------------------------------------------------

function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(asText(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Epoch millis for an ISO-8601-with-offset column, or `null` when blank or unreadable. */
export function parseIso(value: unknown): number | null {
  const text = asText(value);
  if (text === "") return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAssetKind(value: string): value is AssetKind {
  return value === "house" || value === "garden" || value === "car";
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function personFromRow(row: Row): Person | null {
  const id = asText(row["id"]);
  if (id === "") return null;
  return { id, displayName: asText(row["displayName"]) };
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/** A budget that will not parse falls back to `DEFAULT_BUDGETS`, never to NaN. */
function assetFromRow(row: Row): Asset | null {
  const id = asText(row["id"]);
  const kind = asText(row["kind"]);
  if (id === "" || !isAssetKind(kind)) return null;
  const budgetText = asText(row["budget"]);
  const parsedBudget = Number(budgetText);
  const budget = budgetText !== "" && Number.isFinite(parsedBudget) ? parsedBudget : DEFAULT_BUDGETS[kind];
  return { id, kind, budget };
}

function defaultAssets(): Asset[] {
  return (Object.keys(DEFAULT_BUDGETS) as AssetKind[]).map((kind) => ({
    id: kind,
    kind,
    budget: DEFAULT_BUDGETS[kind],
  }));
}

// ---------------------------------------------------------------------------
// Chores — mirrors Records.ts's choreFromRow_ and recurrenceFromRow_ exactly.
// ---------------------------------------------------------------------------

/**
 * `recurrenceUnit` doubles as the discriminant: one of the four interval units, or the
 * literal "timesPerYear". Anything else — including a blank — is a one-off chore with no
 * next occurrence. `recurrenceN <= 0` means no recurrence regardless of the unit.
 */
function recurrenceFromRow(row: Row): Recurrence | null {
  const unit = asText(row["recurrenceUnit"]);
  const n = asNumber(row["recurrenceN"], 0);
  if (n <= 0) return null;
  if (unit === "timesPerYear") return { kind: "timesPerYear", timesPerYear: n };
  if (unit === "day" || unit === "week" || unit === "month" || unit === "year") {
    return { kind: "interval", unit, n };
  }
  return null;
}

/**
 * The exact inverse of the parsing below, used only to let `chore.update`'s partial
 * patch reuse the same parsing path as a fresh row (see `applyChoreRowPatch`).
 */
function choreToRow(chore: Chore): Row {
  const recurrence = chore.recurrence;
  const recurrenceUnit =
    recurrence === null ? "" : recurrence.kind === "timesPerYear" ? "timesPerYear" : recurrence.unit;
  const recurrenceN =
    recurrence === null ? "0" : String(recurrence.kind === "timesPerYear" ? recurrence.timesPerYear : recurrence.n);
  return {
    id: chore.id,
    title: chore.title,
    assetId: chore.assetId,
    weightTime: String(chore.weight.time),
    weightEffort: String(chore.weight.effort),
    weightPriority: String(chore.weight.priority),
    recurrenceUnit,
    recurrenceN,
    nextDueAt: "",
    deadlineDate: chore.deadlineDate ?? "",
    leadTimeDays: chore.leadTimeDays === null ? "" : String(chore.leadTimeDays),
    deletedAt: "",
  };
}

/** A `Chores` row as the domain rules want it. `null` means this row is skipped. */
export function choreFromRow(row: Row): Chore | null {
  const id = asText(row["id"]);
  if (id === "") return null;
  if (asText(row["deletedAt"]) !== "") return null;
  const leadTimeDaysText = asText(row["leadTimeDays"]);
  const deadlineDate = asText(row["deadlineDate"]);
  return {
    id,
    title: asText(row["title"]),
    assetId: asText(row["assetId"]),
    weight: {
      time: asNumber(row["weightTime"], 1),
      effort: asNumber(row["weightEffort"], 1),
      priority: asNumber(row["weightPriority"], 1),
    },
    recurrence: recurrenceFromRow(row),
    deadlineDate: deadlineDate === "" ? null : deadlineDate,
    leadTimeDays: leadTimeDaysText === "" ? null : asNumber(leadTimeDaysText, 0),
    urgencyCurve: null,
  };
}

/**
 * `chore.update`'s payload is `{id}` plus whatever columns changed. Reusing
 * `choreFromRow` on a merge of the existing chore's own columns and the patch keeps
 * there being exactly one place a cell becomes a domain value, and gives a partial
 * update the same "row that will not parse is skipped" behaviour as a fresh one — an
 * unparseable patch is refused (returns `null`) rather than corrupting the existing chore.
 */
export function applyChoreRowPatch(existing: Chore, patch: Row): Chore | null {
  return choreFromRow({ ...choreToRow(existing), ...patch, id: existing.id });
}

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

function instanceFromRow(row: Row): ChoreInstance | null {
  const instanceId = asText(row["instanceId"]);
  const choreId = asText(row["choreId"]);
  if (instanceId === "" || choreId === "") return null;
  // No `now` is available here to fall back to, unlike `instanceFromRow_` on the server.
  // An instance whose due date will not parse is skipped rather than guessed at.
  const dueAt = parseIso(row["dueAt"]);
  if (dueAt === null) return null;
  const calendarEventId = asText(row["calendarEventId"]);
  return {
    instanceId,
    choreId,
    dueAt,
    // Not carried by the wire row at all. `health.ts`'s `overdueDaysOf` recomputes this
    // live from `ctx.now` and `dueAt` whenever both are finite — which, having just
    // skipped every row whose `dueAt` does not parse, they always are here — and only
    // falls back to this stored field when `dueAt` itself is unreadable. So it is dead
    // weight for every instance that reaches this point; 0 is a placeholder, not a claim.
    overdueDays: 0,
    calendarEventId: calendarEventId === "" ? null : calendarEventId,
    lastNotifiedAt: parseIso(row["lastNotifiedAt"]),
    snoozedUntil: parseIso(row["snoozedUntil"]),
  };
}

// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------

function completionFromRow(row: Row): Completion | null {
  const mutationId = asText(row["mutationId"]);
  const instanceId = asText(row["instanceId"]);
  const personId = asText(row["personId"]);
  const choreId = asText(row["choreId"]);
  if (mutationId === "" || instanceId === "" || personId === "" || choreId === "") return null;
  const completedAt = parseIso(row["completedAt"]);
  if (completedAt === null) return null;
  const pointsAwarded = Number(asText(row["pointsAwarded"]));
  if (!Number.isFinite(pointsAwarded)) return null;
  return {
    mutationId,
    instanceId,
    choreId,
    personId,
    completedAt,
    pointsAwarded,
    choreTitle: asText(row["choreTitle"]),
    assetId: asText(row["assetId"]),
  };
}

// ---------------------------------------------------------------------------

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * Rows are strings. This is the only place a cell becomes a domain value.
 * A row that will not parse is skipped, never turned into NaN.
 *
 * `Assets` with no rows — a fresh household — falls back to the three defaults
 * (`house`/`garden`/`car`) via `DEFAULT_BUDGETS` so it still renders. The same fallback
 * applies if every row present turned out to be unreadable, for the same reason.
 */
export function householdFromSnapshot(data: SnapshotData, version: number): Household {
  const people = data.people.map(personFromRow).filter(isPresent);
  const parsedAssets = data.assets.map(assetFromRow).filter(isPresent);
  const assets = parsedAssets.length === 0 ? defaultAssets() : parsedAssets;
  const chores = data.chores.map(choreFromRow).filter(isPresent);
  const instances = data.instances.map(instanceFromRow).filter(isPresent);
  const completions = data.completions.map(completionFromRow).filter(isPresent);

  // Read off the same rows the chores came from, and only for a chore that survived
  // parsing — a date for a chore nothing can render is not worth carrying.
  const live = new Set(chores.map((c) => c.id));
  const nextDueAt: Record<string, number> = {};
  for (const row of data.chores) {
    const id = asText(row["id"]);
    if (!live.has(id)) continue;
    const due = parseIso(row["nextDueAt"]);
    if (due !== null) nextDueAt[id] = due;
  }

  return { people, assets, chores, instances, completions, nextDueAt, version };
}
