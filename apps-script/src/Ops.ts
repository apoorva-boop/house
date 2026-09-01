// The production ops. A SCRIPT, not a module.

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

/**
 * Records that somebody did a chore.
 *
 * The whole body runs inside `getScriptLock()`, and inside it the checks happen in this
 * order, which is the order the plan specifies and the order the tests pin:
 *
 *   1. `mutationId` — one device retrying. The id is minted when the tick is ENQUEUED,
 *      not when it is posted, so a flushed-twice offline queue re-sends the same id and
 *      must be harmless.
 *   2. `instanceId` — two devices. This is the check that actually matters. Two phones
 *      mint two DIFFERENT mutation ids for the same occurrence, so step 1 does not see
 *      them as related at all. Without step 2 a `mutationId`-only server passes every
 *      single-device test and double-writes on the one day both flatmates tick at once.
 *
 * The loser of step 2 gets `ok: true` with the winner's row and `alreadyCompletedBy`. An
 * error would be wrong: nothing went wrong from that phone's point of view, the chore is
 * done, and an error would make its client retry forever or, worse, surface a red state
 * for a chore that is finished.
 *
 * `pointsAwarded` is computed here, from the chore row read inside the lock, and any
 * value the client sent is discarded. A phone with a stale copy of the chore, a bug, or
 * bad intent must not be able to set its own score.
 */
function opComplete_(
  identity: Identity,
  payload: Record<string, unknown>,
  mutationId: string,
): unknown {
  if (mutationId === "") throw new Error("complete requires a mutationId.");
  const instanceId = asText_(payload["instanceId"]);
  if (instanceId === "") throw new Error("complete requires an instanceId.");
  const choreId = asText_(payload["choreId"]);
  if (choreId === "") throw new Error("complete requires a choreId.");

  const completedAtRaw = asText_(payload["completedAt"]);
  const completedAt = completedAtRaw === "" ? toIso_(Date.now()) : completedAtRaw;
  // A person is whoever the token says they are. The `personId` in the payload is a
  // claim, and it is only trusted for the test identity, which has no People row.
  const personId =
    identity.kind === "person" ? identity.personId : asText_(payload["personId"]);
  if (personId === "") throw new Error("complete requires a personId.");

  return withScriptLock_(() => {
    const completions = readRows_("Completions");

    const replay = findRow_(completions, "mutationId", mutationId);
    if (replay !== null) return { completion: replay.values };

    const claimed = findRow_(completions, "instanceId", instanceId);
    if (claimed !== null) {
      return {
        completion: claimed.values,
        alreadyCompletedBy: asText_(claimed.values["personId"]),
      };
    }

    const choreRow = findLiveChore_(choreId);
    if (choreRow === null) throw new Error(`Unknown chore "${choreId}".`);
    const chore = choreFromRow_(choreRow);

    const row = {
      mutationId,
      instanceId,
      personId,
      choreId: chore.id,
      completedAt,
      pointsAwarded: Domain.weight(chore.weight),
      // Snapshotted, so the stats survive the chore being deleted. A completion that can
      // only say "chore 4f2a" once the chore is gone is not history.
      choreTitle: chore.title,
      assetId: chore.assetId,
    };
    appendRows_("Completions", [row]);

    // The occurrence is over: cancel its reminder and drop the row. `Instances` holds
    // OPEN occurrences only, which is what makes the sweep's idempotence rule — one
    // open instance per chore — decidable from the sheet alone.
    closeInstance_(instanceId);
    advanceChore_(choreRow, chore, completedAt);
    bumpVersion_();
    return { completion: row };
  });
}

/**
 * Moves the chore on to its next occurrence, using the domain's recurrence rule.
 *
 * The arithmetic is `Domain.nextDueFrom`, never a millisecond addition here: a monthly
 * chore due 09:00 local has to stay due 09:00 local across a daylight-saving change, and
 * 31 January plus a month has to be 28 February rather than 3 March. Both of those are
 * already solved in `packages/domain`, tested there, and shared with the client. A
 * second copy in Apps Script would drift.
 */
function advanceChore_(choreRow: SheetRow, chore: DomainChore, completedAt: string): void {
  if (chore.recurrence === null) return;
  const lastDone = parseIso_(completedAt);
  if (lastDone === null) return;
  const ctx: DomainCtx = { now: lastDone, timeZone: householdTimeZone_() };
  patchRow_("Chores", choreRow, { nextDueAt: toIso_(Domain.nextDueFrom(ctx, lastDone, chore)) });
}

// ---------------------------------------------------------------------------
// chore.create / chore.update / chore.delete
// ---------------------------------------------------------------------------

function opChoreCreate_(payload: Record<string, unknown>): unknown {
  return withScriptLock_(() => {
    const id = asText_(payload["id"]) === "" ? newId_() : asText_(payload["id"]);
    const row: Record<string, unknown> = { id };
    for (const header of headersFor_("Chores")) {
      if (header === "id") continue;
      row[header] = asText_(payload[header]);
    }
    appendRows_("Chores", [row]);
    bumpVersion_();
    return { chore: row };
  });
}

/**
 * Edits a chore, and drags its open reminders along with it.
 *
 * The due date is the field that matters. A reminder left sitting on the old date after
 * the chore has moved is worse than no reminder at all: it fires on a day the chore is
 * not due, and it teaches the household to ignore the channel. Whether the channel moves
 * the event or replaces it is the channel's business — what must never survive is the
 * old event on the old date.
 */
function opChoreUpdate_(payload: Record<string, unknown>): unknown {
  const id = asText_(payload["id"]);
  if (id === "") throw new Error("chore.update requires an id.");

  return withScriptLock_(() => {
    const row = findRow_(readRows_("Chores"), "id", id);
    if (row === null) throw new Error(`Unknown chore "${id}".`);

    const patch: Record<string, unknown> = {};
    for (const header of headersFor_("Chores")) {
      if (header === "id") continue;
      if (Object.prototype.hasOwnProperty.call(payload, header)) patch[header] = asText_(payload[header]);
    }
    patchRow_("Chores", row, patch);

    const updated = findRow_(readRows_("Chores"), "id", id);
    if (updated !== null && Object.prototype.hasOwnProperty.call(patch, "nextDueAt")) {
      rescheduleInstancesOfChore_(updated, asText_(patch["nextDueAt"]));
    }
    bumpVersion_();
    return { chore: updated === null ? {} : updated.values };
  });
}

/**
 * Retires a chore.
 *
 * Soft delete: the row keeps its `deletedAt` stamp rather than vanishing, so a
 * completion row that names it still resolves and nothing that already happened changes
 * shape. What DOES go immediately is every open instance and every reminder pointing at
 * them — an alert for a chore the household has decided it no longer does is exactly the
 * orphan this channel exists to avoid.
 *
 * History is untouched: `Completions` carries its own `choreTitle` and `assetId`.
 */
function opChoreDelete_(payload: Record<string, unknown>): unknown {
  const id = asText_(payload["id"]);
  if (id === "") throw new Error("chore.delete requires an id.");

  return withScriptLock_(() => {
    const row = findRow_(readRows_("Chores"), "id", id);
    if (row === null) throw new Error(`Unknown chore "${id}".`);
    closeInstancesOfChore_(id);
    patchRow_("Chores", row, { deletedAt: toIso_(Date.now()) });
    bumpVersion_();
    return { id, deletedAt: true };
  });
}

// ---------------------------------------------------------------------------
// sweep.run / calendar.reconcile
// ---------------------------------------------------------------------------

function opSweepRun_(payload: Record<string, unknown>): unknown {
  const now = parseIso_(payload["now"]) ?? Date.now();
  return withScriptLock_(() => {
    const result = runDueSweep_(now);
    bumpVersion_();
    return result;
  });
}

function opCalendarReconcile_(payload: Record<string, unknown>): unknown {
  const now = parseIso_(payload["now"]) ?? Date.now();
  return withScriptLock_(() => reconcileCalendar_(now));
}

/** The time-driven trigger's entry point. `sweep.run` is the same work over HTTP. */
function dueSweepTrigger(): void {
  withScriptLock_(() => runDueSweep_(Date.now()));
}

// Apps Script calls this; nothing in this repo does. A top-level `function` in a `.gs`
// file is already a global, so this line changes nothing at runtime — it states the
// contract and stops the linter reporting the platform's entry point as dead code.
globalThis.dueSweepTrigger = dueSweepTrigger;

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

/** Everything a client needs to render, in one read. Served by `doGet` and `snapshot`. */
function opSnapshot_(): unknown {
  return {
    people: readRows_("People").map((row) => ({
      id: row.values["id"],
      displayName: row.values["displayName"],
    })),
    assets: readRows_("Assets").map((row) => row.values),
    chores: readRows_("Chores")
      .filter((row) => asText_(row.values["deletedAt"]) === "")
      .map((row) => row.values),
    instances: readRows_("Instances").map((row) => row.values),
    completions: readRows_("Completions").map((row) => row.values),
  };
}
