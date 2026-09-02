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
    if (replay !== null) return { completion: repairCompletion_(replay) };

    const claimed = findRow_(completions, "instanceId", instanceId);
    if (claimed !== null) {
      return {
        completion: repairCompletion_(claimed),
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

    // The occurrence is over: cancel its reminder, drop the row, and move the chore on to
    // whatever comes next. `Instances` holds OPEN occurrences only, which is what makes
    // the sweep's idempotence rule — one open instance per chore — decidable from the
    // sheet alone. Every step of this is in `settleCompletion_` rather than inline,
    // because the replay path above has to be able to run exactly the same steps.
    settleCompletion_(instanceId, chore.id, completedAt);
    bumpVersion_();
    return { completion: row };
  });
}

/**
 * Finishes a completion that is already on the sheet, and hands back its row.
 *
 * The lock is not a transaction: a run can die between appending the Completions row and
 * closing the occurrence, which commits the completion and leaves the occurrence open,
 * the chore un-advanced and `version` unbumped — so the client sees nothing change and
 * retries. Both early returns above are exactly where that retry lands, and an early
 * return that only echoed the stored row left the household stuck there permanently.
 *
 * `settleCompletion_` is a no-op on a completion that already finished, so the ordinary
 * replay still costs nothing but the read. The instanceId claim is untouched: it is still
 * decided above, against the rows read inside the lock, and still admits one row per
 * occurrence.
 *
 * The stored row, not the payload, decides what gets repaired. A retry with a mismatched
 * body must not be able to point the repair at some other chore.
 */
function repairCompletion_(stored: SheetRow): Record<string, string> {
  const settled = settleCompletion_(
    asText_(stored.values["instanceId"]),
    asText_(stored.values["choreId"]),
    asText_(stored.values["completedAt"]),
  );
  if (settled) bumpVersion_();
  return stored.values;
}

// `advanceChore_` used to live here and only wrote `nextDueAt` back to the Chores row.
// It has been replaced by `settleChoreAfterCompletion_` in DueSweep.ts, which writes that
// same date AND puts a single calendar event on it. Under calendar authority a next date
// that exists only in a spreadsheet cell is a date nobody can see and nobody can move.

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
