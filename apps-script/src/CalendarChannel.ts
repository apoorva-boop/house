// The notification channel. A SCRIPT, not a module.
//
// ---------------------------------------------------------------------------
// Why this is an interface and not just calendar code
// ---------------------------------------------------------------------------
// Calendar is the STOP-LOSS for the whole project. Declarative Web Push on iOS is the
// thing most likely not to work, and if it does not, this is the channel that ships.
// Push arrives later as a SECOND implementation of `NotificationSender`: the relay is a
// new file and a registration, not a rewrite of the sweep.
//
// BE PRECISE ABOUT WHAT THE SEAM COVERS. It covers SENDING a reminder, and nothing else.
// It does NOT make Calendar swappable, and this file must not be read as saying so.
//
// Since the v3 decision, Google Calendar is AUTHORITATIVE for when a chore is next due:
// drag an event and the due date moves, delete an event and the chore is unscheduled.
// `DueSweep` therefore talks to Calendar directly and by name — `calendarStartsByEventId_`
// and `calendarDriftToleranceMs_` are neither of them on `NotificationSender`, and the
// `Instances` schema has a literal `calendarEventId` column. Calendar can be ADDED to.
// It cannot be removed.
//
// So the reason dropping the push work stays safe is NOT "swap the implementation".
// It is that Calendar is already the load-bearing channel and push was only ever a
// second one alongside it. Nothing has to be swapped out, because nothing was ever
// standing in for Calendar.
//
// ---------------------------------------------------------------------------
// Why every event carries a tag
// ---------------------------------------------------------------------------
// The instance id is stored as an event TAG, written with `CalendarEvent.setTag` and read
// back with `getTag`. That tag is the only thing that makes an orphan findable. A run that
// creates an event and then dies before persisting the id leaves an event on somebody's
// calendar that no row points at and no query can match. Tagged, `calendar.reconcile`
// finds it and removes it. Untagged, it nags forever about a chore nobody can tick off.
//
// Which namespace the tag actually lands in is NOT VERIFIED. Google documents `setTag`
// only as "custom metadata" and does not say whether it writes
// `extendedProperties.private` or `extendedProperties.shared`; nothing here has been
// checked against the API. It does not matter for us: these events have no guests, so
// even `shared` is shared with nobody, the calendar is already visible to both people,
// and reconcile reads the tag back with `getTag` — the same accessor that wrote it — so
// the round trip is self-consistent either way. Do not restate the namespace as fact
// without checking it.
//
// The id is repeated in the description as a plain marker. It costs one line and means
// a human looking at a stray event can see where it came from.

/** What a channel needs to deliver one reminder. Channel-agnostic on purpose. */
interface NotificationRequest {
  readonly instanceId: string;
  readonly title: string;
  readonly body: string;
  readonly dueAt: number;
}

/**
 * A way to tell the household a chore is due.
 *
 * `send` returns an opaque reference the caller persists, and hands back to `cancel` or
 * `reschedule` later. For Calendar it is an event id; for push it will be a message or
 * topic id. Nothing outside this file knows which.
 */
interface NotificationSender {
  readonly channel: string;
  send(request: NotificationRequest): string;
  cancel(reference: string): void;
  /** Moves an existing reminder. False means it is gone and must be sent again. */
  reschedule(reference: string, request: NotificationRequest): boolean;
}

/** The tag key. Named for the column it mirrors, so a stray event is self-describing. */
function instanceTagKey_(): string {
  return "instanceId";
}

/** Reminders are 30-minute blocks: long enough to see, short enough not to eat a day. */
function eventDurationMs_(): number {
  return 30 * 60 * 1000;
}

function calendarSender_(): NotificationSender {
  return {
    channel: "calendar",

    send(request: NotificationRequest): string {
      const start = new Date(request.dueAt);
      const end = new Date(request.dueAt + eventDurationMs_());
      const event = calendar_().createEvent(request.title, start, end, {
        description: `${request.body}\n\ninstanceId=${request.instanceId}`,
      });
      event.setTag(instanceTagKey_(), request.instanceId);
      return event.getId();
    },

    cancel(reference: string): void {
      // `liveCalendarEvent_`, never `calendarEventById_` on its own. Google hands back a
      // deleted event as a live object, and calling `deleteEvent()` on that tombstone
      // throws — out of `cancel`, out of `closeInstance_`, and out of the completion that
      // called it, which is how a hand-deleted reminder used to break ticking the chore off.
      const event = liveCalendarEvent_(reference);
      if (event !== null) event.deleteEvent();
    },

    reschedule(reference: string, request: NotificationRequest): boolean {
      // Same tombstone, different damage. `getEventById` returns an object for an event
      // the household deleted, `setTime` on it "succeeds", and returning true here would
      // tell `rescheduleInstancesOfChore_` the reminder had moved — so the row would be
      // stamped `scheduled` with a dead id and the user's edit would produce no event at
      // all. False means gone, and the caller sends a fresh one.
      const event = liveCalendarEvent_(reference);
      if (event === null) return false;
      event.setTime(new Date(request.dueAt), new Date(request.dueAt + eventDurationMs_()));
      event.setTitle(request.title);
      // Re-stamped in case the event was ever touched by hand. A tag is cheap; an
      // untaggable orphan is not.
      event.setTag(instanceTagKey_(), request.instanceId);
      return true;
    },
  };
}

/** The one sender wired in today. PR 5 adds a push sender beside it. */
function notificationSender_(): NotificationSender {
  return calendarSender_();
}

/**
 * Looks an event up by id, returning null rather than throwing when it is gone.
 * An event deleted by hand is a normal state here, not an error.
 */
function calendarEventById_(eventId: string): GoogleAppsScript.Calendar.CalendarEvent | null {
  try {
    return calendar_().getEventById(eventId);
  } catch {
    return null;
  }
}

/** The instance an event belongs to, or "" for an event this server did not create. */
function eventInstanceId_(event: GoogleAppsScript.Calendar.CalendarEvent): string {
  return asText_(event.getTag(instanceTagKey_()));
}

/** A window wide enough that no reminder this server ever writes falls outside it. */
function calendarWindow_(nowMs: number): { start: Date; end: Date } {
  const oneYear = 400 * 24 * 60 * 60 * 1000;
  return { start: new Date(nowMs - oneYear), end: new Date(nowMs + oneYear) };
}

function taggedEvents_(nowMs: number): GoogleAppsScript.Calendar.CalendarEvent[] {
  const window = calendarWindow_(nowMs);
  return taggedEventsBetween_(window.start, window.end);
}

/**
 * Every event this server created between two instants, and nothing else.
 *
 * Split out of `taggedEvents_` so a caller that knows its own bounds can say so. The
 * only such caller is `test.clear`/`test.reset`, whose fixtures live within weeks of
 * now rather than within the year-and-a-bit the sweep has to cover. The TAG FILTER is
 * in here, not in the caller, so no narrower window can accidentally be paired with an
 * unfiltered listing: an untagged event is not ours to touch at any width.
 */
function taggedEventsBetween_(
  start: Date,
  end: Date,
): GoogleAppsScript.Calendar.CalendarEvent[] {
  return calendar_()
    .getEvents(start, end)
    .filter((event) => eventInstanceId_(event) !== "");
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

/**
 * Deletes every tagged event whose instance no longer exists, and NOTHING else.
 *
 * This is the crash recovery for the one window that cannot be closed by ordering
 * alone: an event created, then the run dies before the delete that a completion or a
 * chore deletion would have issued. The tag is what makes those events findable.
 *
 * A scalpel, not a bulldozer. An event whose instance is still live is a reminder
 * somebody still needs, and an untagged event belongs to a human, not to this server.
 */
function reconcileCalendar_(nowMs: number): { removed: string[] } {
  const live: Record<string, true> = {};
  for (const row of readRows_("Instances")) {
    const instanceId = row.values["instanceId"];
    if (instanceId !== undefined && instanceId !== "") live[instanceId] = true;
  }

  const removed: string[] = [];
  for (const event of taggedEvents_(nowMs)) {
    const instanceId = eventInstanceId_(event);
    if (live[instanceId] === true) continue;
    const eventId = event.getId();
    event.deleteEvent();
    removed.push(eventId);
  }
  return { removed };
}

// ---------------------------------------------------------------------------
// Reading the calendar back
// ---------------------------------------------------------------------------
// The calendar is not just an output. It is where the next due DATE actually lives, so
// every sweep asks it what it says before it does anything else. These two functions are
// the whole read side.

/**
 * Every event this server owns that the calendar still HOLDS, as event id -> start time.
 *
 * Built from a LISTING, never from `getEventById` per row, and that is the whole point of
 * the function. `getEventById` is not a liveness test. Google keeps a deleted event as a
 * tombstone and hands it straight back — probed against this very calendar: create an
 * event, delete it the way `calendar.reconcile` does, then ask `getEventById` for the id
 * and you get an object, not `null`, and its `getStartTime()` is still the original
 * start. A sweep that asked "did this come back null?" was therefore always told the
 * event was fine, and a reminder the household deleted could never be noticed.
 *
 * `getEvents` does exclude the deleted event, so ABSENCE FROM THIS MAP is the definition
 * of gone — the same definition the integration suite uses when it asserts the calendar
 * no longer lists the event. It is also one calendar call per sweep instead of one per
 * row, so the correct answer is the cheap one.
 */
function calendarStartsByEventId_(nowMs: number): Record<string, number> {
  const starts: Record<string, number> = {};
  for (const event of taggedEvents_(nowMs)) {
    const start = event.getStartTime();
    if (start === null || start === undefined) continue;
    const ms = start.getTime();
    if (Number.isFinite(ms)) starts[event.getId()] = ms;
  }
  return starts;
}

/**
 * The event behind a reference, or `null` when the calendar no longer LISTS it.
 *
 * The one liveness test in this file, and it is the sweep's: presence in
 * `calendarStartsByEventId_`. `getEventById` cannot answer this question — see that
 * function's docstring for the probe — so nothing outside this helper is allowed to
 * decide from it alone that an event is alive. The `getEventById` call below only turns
 * an id the listing has already vouched for into the object the caller has to write to.
 */
function liveCalendarEvent_(
  reference: string,
): GoogleAppsScript.Calendar.CalendarEvent | null {
  if (reference === "") return null;
  if (calendarStartsByEventId_(Date.now())[reference] === undefined) return null;
  return calendarEventById_(reference);
}

/**
 * How far the event's start may sit from the row's `dueAt` before the sweep calls it a
 * MOVE. One minute.
 *
 * Not zero, and this is the reason: the row stores an ISO instant with milliseconds,
 * Google stores an event time to the second, so an event created from `dueAt` reads back
 * up to 999 ms away from it without anybody having touched it. At a zero tolerance every
 * sweep would score that echo as a drag, rewrite `dueAt`, clear `lastNotifiedAt`, and
 * re-alert about the same chore every hour forever.
 *
 * A minute is far below any real edit — Google Calendar's own grid snaps to fifteen —
 * and far above the rounding.
 */
function calendarDriftToleranceMs_(): number {
  return 60_000;
}
