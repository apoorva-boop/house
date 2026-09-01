// The due sweep. A SCRIPT, not a module.
//
// ---------------------------------------------------------------------------
// Sole owner of materialisation
// ---------------------------------------------------------------------------
// Nothing else in this server creates a row in `Instances`. A chore describes a
// recurrence; an instance is one occurrence of it. If a second code path could also
// materialise one — the client, a completion, an edit — then "how many occurrences of
// this chore are open" would have as many answers as there are writers, and the sweep
// could never be made idempotent.
//
// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------
// A time-driven trigger asking for "every hour" is honoured to about +/- 15 minutes, so
// consecutive runs overlap as a matter of course, and a retried run repeats a window
// wholesale. Running twice over the same window must therefore produce exactly what
// running once produces. The rule that gets that: a chore with an OPEN instance never
// gets a second one. An instance is closed by being completed, which deletes the row and
// advances the chore — so the row's existence is the whole state machine.
//
// ---------------------------------------------------------------------------
// The re-notify gate is `lastNotifiedAt`, not the channel
// ---------------------------------------------------------------------------
// It is tempting to lean on the channel: Calendar will not duplicate an event it already
// holds, and push `Topic` coalescing replaces an undelivered message. Neither is a gate.
// Coalescing only suppresses a message that has NOT reached the phone yet; once the
// first alert has landed, a second one is a new message and the topic does nothing. So
// the sweep records that it told someone, on the row, and the domain's `eligible` reads
// that stamp. The stamp is written only after the channel has actually accepted the
// send.

interface SweepResult {
  readonly created: string[];
  readonly notified: string[];
}

/** Repeat-nag is off by default: tell us once. A household opts in, per the plan. */
function notifyPolicy_(): { repeatEveryHours: number | null } {
  return { repeatEveryHours: null };
}

/**
 * Materialises every chore that has come due, then alerts on every open instance the
 * domain says is eligible.
 *
 * Callable as the `sweep.run` op as well as from the time-driven trigger. The suite
 * cannot wait fifteen minutes for a trigger, and a sweep that only a trigger can start
 * is a sweep nothing can test.
 */
function runDueSweep_(nowMs: number): SweepResult {
  const ctx: DomainCtx = { now: nowMs, timeZone: householdTimeZone_() };
  const created: string[] = [];
  const notified: string[] = [];

  const chores = liveChoresById_();
  const openChoreIds: Record<string, true> = {};
  for (const row of readRows_("Instances")) {
    openChoreIds[asText_(row.values["choreId"])] = true;
  }

  const fresh: Record<string, unknown>[] = [];
  for (const choreId of Object.keys(chores)) {
    const row = chores[choreId];
    if (row === undefined) continue;
    if (openChoreIds[choreId] === true) continue;

    const nextDueAt = asText_(row.values["nextDueAt"]);
    const dueMs = parseIso_(nextDueAt);
    // A blank or unreadable due date is a chore nobody has scheduled, not one that is
    // infinitely overdue. Leave it alone rather than materialising noise.
    if (dueMs === null || dueMs > nowMs) continue;

    const instanceId = newId_();
    fresh.push({
      instanceId,
      choreId,
      dueAt: nextDueAt,
      calendarEventId: "",
      lastNotifiedAt: "",
      snoozedUntil: "",
    });
    created.push(instanceId);
  }
  appendRows_("Instances", fresh);

  // Re-read so the rows just appended come back with their sheet row numbers, which the
  // notification pass needs in order to write `calendarEventId` and `lastNotifiedAt`.
  for (const row of readRows_("Instances")) {
    const chore = chores[asText_(row.values["choreId"])];
    if (chore === undefined) continue;
    const instance = instanceFromRow_(row, nowMs);
    if (!Domain.eligible(ctx, instance, notifyPolicy_())) continue;
    if (deliverReminder_(row, chore, instance, nowMs)) notified.push(instance.instanceId);
  }

  return { created, notified };
}

/**
 * Sends one reminder and records that it was sent.
 *
 * Returns whether anything actually went out, which today is always true: Calendar
 * either accepts the event or throws, and a throw fails the whole sweep loudly rather
 * than stamping `lastNotifiedAt` for a reminder nobody got. The boolean is here because
 * the push sender will not be all-or-nothing — some subscriptions are dead — and the
 * caller must not record "told them" on the strength of a send that partly failed.
 *
 * Ordering is the point of this function. The channel reference is persisted to the
 * sheet IMMEDIATELY after the channel accepts the send, in its own write, BEFORE
 * `lastNotifiedAt` and before anything could later want to cancel it. A crash between
 * the send and the persist is the one failure that strands an event nothing can find;
 * making that window a single statement wide is as narrow as it gets, and
 * `calendar.reconcile` is the backstop for the case where it still loses.
 */
function deliverReminder_(
  row: SheetRow,
  choreRow: SheetRow,
  instance: DomainInstance,
  nowMs: number,
): boolean {
  const sender = notificationSender_();
  const request: NotificationRequest = {
    instanceId: instance.instanceId,
    title: asText_(choreRow.values["title"]),
    body: "Due now. Tick it off in the house app.",
    dueAt: instance.dueAt,
  };

  let reference = instance.calendarEventId ?? "";
  if (reference === "") {
    reference = sender.send(request);
    patchRow_("Instances", row, { calendarEventId: reference });
  }
  patchRow_("Instances", row, { calendarEventId: reference, lastNotifiedAt: toIso_(nowMs) });
  return true;
}

/**
 * Closes one open instance: cancels its reminder, then removes the row.
 *
 * Cancel first, delete second. The other order strands an event on somebody's calendar
 * whenever the run dies in between — an alert about a chore that no longer has a row to
 * tick off. This order can only leave a row pointing at an already-cancelled event,
 * which is invisible and self-corrects the next time anything touches it.
 */
function closeInstance_(instanceId: string): void {
  const rows = filterRows_(readRows_("Instances"), "instanceId", instanceId);
  const sender = notificationSender_();
  for (const row of rows) {
    sender.cancel(asText_(row.values["calendarEventId"]));
  }
  deleteRows_(
    "Instances",
    rows.map((row) => row.rowNumber),
  );
}

/** Closes every open instance of a chore. Used when the chore itself goes away. */
function closeInstancesOfChore_(choreId: string): void {
  const rows = filterRows_(readRows_("Instances"), "choreId", choreId);
  const sender = notificationSender_();
  for (const row of rows) {
    sender.cancel(asText_(row.values["calendarEventId"]));
  }
  deleteRows_(
    "Instances",
    rows.map((row) => row.rowNumber),
  );
}

/**
 * Moves every open instance of a chore to a new due date, and moves its reminder with
 * it. A reminder left on the old date is worse than no reminder: it nags on a day the
 * chore is not due, and it teaches people to ignore the channel.
 */
function rescheduleInstancesOfChore_(choreRow: SheetRow, dueAtIso: string): void {
  const dueMs = parseIso_(dueAtIso);
  if (dueMs === null) return;
  const sender = notificationSender_();

  for (const row of filterRows_(readRows_("Instances"), "choreId", asText_(choreRow.values["id"]))) {
    const request: NotificationRequest = {
      instanceId: asText_(row.values["instanceId"]),
      title: asText_(choreRow.values["title"]),
      body: "Due now. Tick it off in the house app.",
      dueAt: dueMs,
    };
    const reference = asText_(row.values["calendarEventId"]);
    if (reference !== "" && sender.reschedule(reference, request)) {
      patchRow_("Instances", row, { dueAt: dueAtIso });
      continue;
    }
    // The reminder is gone from the channel. Drop the dead reference in the same write
    // that moves the date, so the row never claims a reminder that does not exist; the
    // next sweep sends a fresh one.
    patchRow_("Instances", row, { dueAt: dueAtIso, calendarEventId: "", lastNotifiedAt: "" });
  }
}
