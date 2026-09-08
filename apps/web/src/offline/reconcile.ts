// The queue IS the optimistic state — there is no separate optimistic store. This file
// replays it on top of the last server snapshot, one queued mutation at a time, in the
// same order the queue will eventually send them in.
import type { Completion, DomainCtx } from "@house/domain";
import { nextDueFrom, weight } from "@house/domain";
import { applyChoreRowPatch, choreFromRow, parseIso } from "../model/Household.js";
import type { Household } from "../model/Household.js";
import type { Row } from "../gateway/SheetsGateway.js";
import type { QueuedMutation } from "./MutationQueue.js";

function asRow(payload: unknown): Row | null {
  if (typeof payload !== "object" || payload === null) return null;
  const row: Row = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    row[key] = String(value);
  }
  return row;
}

function asText(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

/**
 * `complete`'s handler mirrors the server's `settleCompletion_` /
 * `settleChoreAfterCompletion_` in apps-script/src/DueSweep.ts:
 *   1. Append a Completion carrying the queued mutationId (skipped if one is already in
 *      `household`, which is the "skip any row whose mutationId is still in the queue"
 *      rule), with `pointsAwarded`/`choreTitle`/`assetId` snapshotted from the chore.
 *   2. Remove the matching open instance — the server deletes that row outright.
 *   3. A recurring chore's `nextDueAt` moves to `nextDueFrom(...)`. A non-recurring one
 *      loses its date entirely: it is finished when it is done, which is the blank the
 *      server writes for a warrant of fitness — read the long comment on
 *      `settleChoreAfterCompletion_` for why blank rather than a done marker.
 *
 * Writing the date rather than opening a replacement instance is deliberate, and it is
 * what the server does: `settleCompletion_` deletes the `Instances` row and sets the
 * `Chores` column, and only a later `runDueSweep_` materialises the next occurrence —
 * with a calendar event, which is the part no client can invent.
 */
function applyComplete(ctx: DomainCtx, household: Household, mutation: QueuedMutation, personId: string): Household {
  if (typeof mutation.payload !== "object" || mutation.payload === null) return household;
  const payload = mutation.payload as Record<string, unknown>;
  const instanceId = asText(payload, "instanceId");
  const choreId = asText(payload, "choreId");
  // The queued payload carries what will go on the wire: ISO-8601 with offset. The
  // number branch is for a mutation enqueued by an older build of this app, which would
  // otherwise be dropped silently on the reload that upgrades it.
  const completedAtRaw = payload["completedAt"];
  const completedAt =
    typeof completedAtRaw === "number" ? completedAtRaw : (parseIso(completedAtRaw) ?? Number.NaN);
  if (instanceId === null || choreId === null || !Number.isFinite(completedAt)) return household;

  if (household.completions.some((c) => c.mutationId === mutation.mutationId)) return household;

  const chore = household.chores.find((c) => c.id === choreId);
  if (chore === undefined) return household;

  const completion: Completion = {
    mutationId: mutation.mutationId,
    instanceId,
    choreId,
    personId,
    completedAt,
    pointsAwarded: weight(chore.weight),
    choreTitle: chore.title,
    assetId: chore.assetId,
  };
  const completions = [...household.completions, completion];

  // Every open occurrence of this chore closes, not merely the one whose id was posted.
  // An early tick carries a client-minted instanceId that matches no row, and leaving the
  // real open instance behind would show the chore as still overdue straight after it was
  // ticked. `closeInstance_` on the server is by instanceId, but `settleChoreAfterCompletion_`
  // then moves the date, and the next sweep closes anything stale.
  const instances = household.instances.filter(
    (i) => i.instanceId !== instanceId && i.choreId !== choreId,
  );

  const nextDueAt = { ...household.nextDueAt };

  if (chore.recurrence === null) {
    delete nextDueAt[choreId];
    return { ...household, completions, instances, nextDueAt };
  }

  try {
    nextDueAt[choreId] = nextDueFrom(ctx, completedAt, chore);
  } catch {
    // `nextDueFrom` throws on a non-finite input. A chore whose recurrence will not
    // parse keeps the date it had rather than taking the whole render down — the
    // completion still counts, the date simply does not move.
  }
  return { ...household, completions, instances, nextDueAt };
}

function applyChoreCreate(household: Household, mutation: QueuedMutation): Household {
  const row = asRow(mutation.payload);
  if (row === null) return household;
  const chore = choreFromRow(row);
  if (chore === null) return household;
  if (household.chores.some((c) => c.id === chore.id)) return household;
  const nextDueAt = { ...household.nextDueAt };
  const due = parseIso(row["nextDueAt"]);
  if (due !== null) nextDueAt[chore.id] = due;
  return { ...household, chores: [...household.chores, chore], nextDueAt };
}

function applyChoreUpdate(household: Household, mutation: QueuedMutation): Household {
  const row = asRow(mutation.payload);
  if (row === null) return household;
  const id = row["id"] ?? "";
  if (id === "") return household;
  const existing = household.chores.find((c) => c.id === id);
  if (existing === undefined) return household;
  const patched = applyChoreRowPatch(existing, row);
  if (patched === null) return household;
  const nextDueAt = { ...household.nextDueAt };
  // Only when the patch actually carried the column. `chore.update` sends the columns
  // that changed, so an absent key means "leave the date alone", not "clear it".
  if (Object.prototype.hasOwnProperty.call(row, "nextDueAt")) {
    const due = parseIso(row["nextDueAt"]);
    if (due === null) delete nextDueAt[id];
    else nextDueAt[id] = due;
  }
  return {
    ...household,
    chores: household.chores.map((c) => (c.id === id ? patched : c)),
    nextDueAt,
  };
}

function applyChoreDelete(household: Household, mutation: QueuedMutation): Household {
  const row = asRow(mutation.payload);
  if (row === null) return household;
  const id = row["id"] ?? "";
  if (id === "") return household;
  const nextDueAt = { ...household.nextDueAt };
  delete nextDueAt[id];
  return {
    ...household,
    chores: household.chores.filter((c) => c.id !== id),
    instances: household.instances.filter((i) => i.choreId !== id),
    nextDueAt,
  };
}

function applyOne(ctx: DomainCtx, household: Household, mutation: QueuedMutation, personId: string): Household {
  switch (mutation.op) {
    case "complete":
      return applyComplete(ctx, household, mutation, personId);
    case "chore.create":
      return applyChoreCreate(household, mutation);
    case "chore.update":
      return applyChoreUpdate(household, mutation);
    case "chore.delete":
      return applyChoreDelete(household, mutation);
    default:
      return household;
  }
}

/**
 * The queue IS the optimistic state. Replay it, in ascending `seq` order, on top of the
 * server snapshot. Pure in `ctx`, `base`, `queued` and `personId`: replaying the same
 * queue on top of the same snapshot twice produces the same household both times, which
 * is what lets `load()` and `refresh()` call this as often as they like.
 */
export function applyPending(
  ctx: DomainCtx,
  base: Household,
  queued: readonly QueuedMutation[],
  personId: string,
): Household {
  const ordered = queued.slice().sort((a, b) => a.seq - b.seq);
  let household = base;
  for (const mutation of ordered) {
    household = applyOne(ctx, household, mutation, personId);
  }
  return household;
}
