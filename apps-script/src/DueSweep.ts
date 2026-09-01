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
// The calendar is read FIRST, every time
// ---------------------------------------------------------------------------
// Google Calendar holds the DATE a chore is next due; this spreadsheet holds the
// recurrence rule, the weights and the history. So an edit made in Calendar WINS. Drag
// the gutters event to Saturday and the gutters are due Saturday. Delete it and the
// chore is not currently scheduled — the chore and its completions stay exactly where
// they are, because nothing about deleting a reminder says "I never do this".
//
// That is why `reconcileInstancesFromCalendar_` runs before materialisation and before
// any alert. A sweep that materialised or alerted first would be acting on a date the
// household has already changed.
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
  /** Instances whose `dueAt` was moved because their event was moved in Calendar. */
  readonly rescheduled: string[];
  /** Instances whose event was deleted in Calendar. They now have no due date. */
  readonly unscheduled: string[];
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

  // Before anything else. The calendar may have been edited since the last run, and
  // every decision below — is this chore already open, is it due, should it alert —
  // reads a `dueAt` that only this pass can make true.
  const readBack = reconcileInstancesFromCalendar_();

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
      scheduleState: scheduleStateScheduled_(),
    });
    created.push(instanceId);
  }
  appendRows_("Instances", fresh);

  // Re-read so the rows just appended come back with their sheet row numbers, which the
  // notification pass needs in order to write `calendarEventId` and `lastNotifiedAt`.
  for (const row of readRows_("Instances")) {
    const chore = chores[asText_(row.values["choreId"])];
    if (chore === undefined) continue;
    // An unscheduled occurrence is one whose event the household deleted. Sending a new
    // one would make that deletion un-doable: the reminder would simply come back an
    // hour later. It stays silent until somebody edits the chore or completes it.
    if (isUnscheduled_(row)) continue;
    const instance = instanceFromRow_(row, nowMs);
    if (!Domain.eligible(ctx, instance, notifyPolicy_())) continue;
    if (deliverReminder_(row, chore, instance, nowMs)) notified.push(instance.instanceId);
  }

  return {
    created,
    notified,
    rescheduled: readBack.rescheduled,
    unscheduled: readBack.unscheduled,
  };
}

/**
 * Makes every `Instances` row agree with the calendar event it points at.
 *
 * Three outcomes per row, and only three:
 *
 *   moved    The event's start no longer matches `dueAt`. The event wins: `dueAt` is
 *            rewritten from it and `lastNotifiedAt` is cleared, because a chore moved to
 *            a new date deserves a fresh alert when that date arrives.
 *   gone     `getEventById` finds nothing. The row is marked `unscheduled` and its dead
 *            `calendarEventId` is dropped. The row itself STAYS: deleting it would let
 *            the materialisation pass below re-create the occurrence and re-send the
 *            event within the same sweep, so deleting an event would do nothing at all.
 *            The chore row and every completion are untouched.
 *   matches  Nothing is written. Most rows, most sweeps.
 *
 * Rows with no `calendarEventId` are skipped rather than unscheduled. They are
 * occurrences that have not been told to the household yet — the notification pass below
 * is what gives them an event, and treating "not sent yet" as "deleted" would mean no
 * reminder was ever sent at all.
 */
function reconcileInstancesFromCalendar_(): { rescheduled: string[]; unscheduled: string[] } {
  const rescheduled: string[] = [];
  const unscheduled: string[] = [];

  for (const row of readRows_("Instances")) {
    if (isUnscheduled_(row)) continue;
    const reference = asText_(row.values["calendarEventId"]);
    if (reference === "") continue;

    const instanceId = asText_(row.values["instanceId"]);
    const startMs = eventStartMs_(reference);

    if (startMs === null) {
      patchRow_("Instances", row, {
        calendarEventId: "",
        lastNotifiedAt: "",
        scheduleState: scheduleStateUnscheduled_(),
      });
      unscheduled.push(instanceId);
      continue;
    }

    const dueMs = parseIso_(row.values["dueAt"]);
    if (dueMs !== null && Math.abs(startMs - dueMs) <= calendarDriftToleranceMs_()) continue;

    patchRow_("Instances", row, {
      dueAt: toIso_(startMs),
      lastNotifiedAt: "",
      scheduleState: scheduleStateScheduled_(),
    });
    rescheduled.push(instanceId);
  }

  return { rescheduled, unscheduled };
}

/**
 * Puts the chore's NEXT occurrence on the calendar, and writes the row that points at it.
 *
 * Two things this deliberately is not.
 *
 * It is not a fixed schedule. The next date is measured from when the chore was DONE,
 * through `Domain.nextDueFrom`, never from the date it was supposed to be done. Clean the
 * bathroom two weeks late and the next one is four weeks from today, not a fortnight
 * away. The arithmetic is the domain's and never a millisecond addition here: a monthly
 * chore due 09:00 local stays due 09:00 local across a daylight-saving change, and
 * 31 January plus a month is 28 February rather than 3 March.
 *
 * It is not a recurring event. Each occurrence is a SINGLE event with no RRULE, which is
 * what keeps a chore six weeks late as ONE chore instead of six stacked occurrences the
 * household has to dismiss one at a time.
 *
 * The event is sent BEFORE the row is appended, so the row can carry the event id in the
 * single write that creates it. The other order would leave a window in which a row
 * exists claiming no event, which the sweep would read as "not told yet" and answer with
 * a second event. A crash between the send and the append leaves a tagged event with no
 * row, which is exactly the orphan `calendar.reconcile` exists to remove.
 */
function scheduleNextOccurrence_(
  choreRow: SheetRow,
  chore: DomainChore,
  completedAt: string,
): string | null {
  if (chore.recurrence === null) return null;
  const lastDone = parseIso_(completedAt);
  if (lastDone === null) return null;

  const ctx: DomainCtx = { now: lastDone, timeZone: householdTimeZone_() };
  const nextDueMs = Domain.nextDueFrom(ctx, lastDone, chore);
  if (!Number.isFinite(nextDueMs) || nextDueMs <= lastDone) return null;
  const nextDueIso = toIso_(nextDueMs);

  // The rule stays on the sheet. `nextDueAt` is the server's own copy of the date, kept
  // so a chore with no open occurrence can still be materialised; the calendar event
  // below is the copy the household can see and drag.
  patchRow_("Chores", choreRow, { nextDueAt: nextDueIso });

  const instanceId = newId_();
  const eventId = notificationSender_().send({
    instanceId,
    title: asText_(choreRow.values["title"]),
    body: "Next time this is due. Move this event to change the date.",
    dueAt: nextDueMs,
  });

  appendRows_("Instances", [
    {
      instanceId,
      choreId: chore.id,
      dueAt: nextDueIso,
      calendarEventId: eventId,
      lastNotifiedAt: "",
      snoozedUntil: "",
      scheduleState: scheduleStateScheduled_(),
    },
  ]);

  return instanceId;
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
      body: "Due then. Move this event to change the date, or tick it off in the house app.",
      dueAt: dueMs,
    };
    const reference = asText_(row.values["calendarEventId"]);
    if (reference !== "" && sender.reschedule(reference, request)) {
      patchRow_("Instances", row, { dueAt: dueAtIso, scheduleState: scheduleStateScheduled_() });
      continue;
    }
    // There is no event, or the one there was has been deleted. A fresh one goes out NOW
    // rather than at the next sweep, because under calendar authority the pending date
    // has nowhere else to live: an occurrence with no event is an occurrence the
    // household cannot see and cannot drag. This is also how a chore that was
    // unscheduled — its event deleted — gets put back on the calendar: by editing it.
    const eventId = sender.send(request);
    patchRow_("Instances", row, {
      dueAt: dueAtIso,
      calendarEventId: eventId,
      lastNotifiedAt: "",
      scheduleState: scheduleStateScheduled_(),
    });
  }
}
