// The notification channel. A SCRIPT, not a module.
//
// ---------------------------------------------------------------------------
// Why this is an interface and not just calendar code
// ---------------------------------------------------------------------------
// Calendar is the STOP-LOSS for the whole project. Declarative Web Push on iOS is the
// thing most likely not to work, and if it does not, this is the channel that ships.
// Push arrives later as a SECOND implementation of `NotificationSender` — `DueSweep`
// asks the sender to deliver and to cancel, and never mentions Calendar by name. That
// is the entire point of the seam: the push relay is a new file and a registration, not
// a rewrite of the sweep.
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
      if (reference === "") return;
      const event = calendarEventById_(reference);
      if (event !== null) event.deleteEvent();
    },

    reschedule(reference: string, request: NotificationRequest): boolean {
      if (reference === "") return false;
      const event = calendarEventById_(reference);
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
  return calendar_()
    .getEvents(window.start, window.end)
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
 * When the calendar says this event starts, or `null` when the event is gone.
 *
 * `null` is a normal answer, not an error: somebody deleting a reminder they do not want
 * is the household telling the app this chore is not currently scheduled, and that has
 * to be readable without a throw.
 */
function eventStartMs_(eventId: string): number | null {
  if (eventId === "") return null;
  const event = calendarEventById_(eventId);
  if (event === null) return null;
  const start = event.getStartTime();
  if (start === null || start === undefined) return null;
  const ms = start.getTime();
  return Number.isFinite(ms) ? ms : null;
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
