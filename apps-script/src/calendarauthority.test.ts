// Google Calendar is the source of truth for WHEN a chore is next due.
//
// ---------------------------------------------------------------------------
// The decision this file encodes
// ---------------------------------------------------------------------------
// The spreadsheet keeps the recurrence RULE, the weights and every completion.
// The calendar keeps the DATE. Two consequences, and both are tested here:
//
// 1. Repeat is measured from the LAST COMPLETION, not from a fixed schedule.
//    Clean the bathroom two weeks late and the next one is four weeks from when
//    you did it, not two weeks from now. So there is no RRULE and no recurring
//    event anywhere: each occurrence is a SINGLE event, and completing a chore
//    computes the next date with the domain's `nextDueFrom` and writes a fresh
//    single event. A chore six weeks late stays ONE chore instead of six stacked
//    occurrences.
//
// 2. Edits made in Google Calendar WIN. Drag the gutters event to Saturday and
//    the app says the gutters are due Saturday. Delete the event and the chore
//    becomes NOT CURRENTLY SCHEDULED — and the chore and its history stay.
//
// ---------------------------------------------------------------------------
// The unscheduled representation
// ---------------------------------------------------------------------------
// A new `Instances` column, `scheduleState`. Blank or "scheduled" means the row
// has a live event; "unscheduled" means the event is gone and nothing is telling
// anyone when this chore is due. `dueAt` is left holding the LAST KNOWN date, so
// the app can still say "was due Saturday" rather than showing a blank, and
// `calendarEventId` is cleared because it points at nothing. The row survives, so
// the sweep will not silently re-materialise the chore and re-create the event
// the household just deleted.
//
// ---------------------------------------------------------------------------
// Why these tests never ask the server to move or delete an event
// ---------------------------------------------------------------------------
// There is no `test.calendar.move` or `test.calendar.delete` op, and adding one
// would mean these tests could not be run RED against the deployment that exists
// today — they would fail on "Unknown op" rather than on the behaviour. So each
// state is manufactured out of the ops the suite already has:
//
//   moved   an event created at T, and an Instances row that says T minus a day.
//           That is exactly the state a drag in Google Calendar leaves behind.
//   deleted a tagged event with no Instances row, swept away by
//           `calendar.reconcile`, and only THEN pointed at by an Instances row.
//           The id is a genuinely deleted event, not a made-up string.

import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  call,
  clearAll,
  complete,
  createTaggedEvent,
  DAY,
  eventsFor,
  instancesFor,
  iso,
  listAllCalendar,
  newId,
  readTab,
  reconcileCalendar,
  requireIntegrationEnv,
  runSweep,
  seedChore,
  seedHousehold,
  seedInstance,
  TEST_TIMEOUT_MS,
  writeRows,
  type Household,
  type Row,
} from "./testkit.js";

/** Google stores event times to the second, and a chore can cross a DST change. */
const CLOSE_ENOUGH_MS = 2 * 60 * 60 * 1000;

function expectAbout(actualIso: string, expectedMs: number, what: string): void {
  const actualMs = Date.parse(actualIso);
  expect(Number.isFinite(actualMs), `${what}: "${actualIso}" is not a readable instant`).toBe(true);
  const driftHours = Math.round((actualMs - expectedMs) / 3_600_000);
  expect(
    Math.abs(actualMs - expectedMs) <= CLOSE_ENOUGH_MS,
    `${what}: got ${new Date(actualMs).toISOString()}, expected about ` +
      `${new Date(expectedMs).toISOString()} (out by ${driftHours} hours)`,
  ).toBe(true);
}

function rowFor(rows: Row[], instanceId: string): Row {
  const found = rows.find((row) => String(row.instanceId) === instanceId);
  if (!found) throw new Error(`No Instances row for ${instanceId}`);
  return found;
}

describe("calendar is the authority on when a chore is due", () => {
  let household: Household;

  beforeAll(() => {
    requireIntegrationEnv();
  });

  beforeEach(async () => {
    await clearAll();
    household = await seedHousehold();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await clearAll();
  }, TEST_TIMEOUT_MS);

  it(
    "moves dueAt to the event's new time when the event has been dragged in Calendar",
    async () => {
      // The chore's own nextDueAt is far away, so nothing but the read-back can
      // put a date on this instance — a sweep that ignored the calendar would
      // leave dueAt exactly where the row says it is.
      const chore = await seedChore(household.houseAssetId, { nextDueAt: iso(90 * DAY) });
      const instanceId = newId();
      const movedTo = Date.now() + 3 * DAY;

      const eventId = await createTaggedEvent({
        instanceId,
        title: chore.title,
        startAt: new Date(movedTo).toISOString(),
      });
      await seedInstance(chore.id, {
        instanceId,
        dueAt: iso(-1 * DAY),
        calendarEventId: eventId,
      });

      const sweep = await runSweep(new Date().toISOString());
      expect(sweep.ok).toBe(true);

      const row = rowFor(await instancesFor(chore.id), instanceId);
      expectAbout(String(row.dueAt), movedTo, "dueAt after the sweep read the calendar back");
      expect(String(row.calendarEventId)).toBe(eventId);
      expect(String(row.scheduleState ?? "")).not.toBe("unscheduled");

      // Following the event must not mean manufacturing a second one.
      expect(eventsFor(await listAllCalendar(), instanceId)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "unschedules the chore when its event is deleted, and keeps the chore and its history",
    async () => {
      const chore = await seedChore(household.houseAssetId, { nextDueAt: iso(-1 * DAY) });

      // A completion from a previous occurrence. This is the history that a
      // deleted calendar event must never take with it.
      const pastInstanceId = newId();
      await writeRows("Completions", [
        {
          mutationId: newId(),
          instanceId: pastInstanceId,
          personId: household.personA.id,
          choreId: chore.id,
          completedAt: iso(-30 * DAY),
          pointsAwarded: chore.expectedPoints,
          choreTitle: chore.title,
          assetId: household.houseAssetId,
        },
      ]);

      // A genuinely deleted event id: created tagged, then swept by reconcile
      // because no Instances row claimed it yet.
      const instanceId = newId();
      const eventId = await createTaggedEvent({
        instanceId,
        title: chore.title,
        startAt: iso(-1 * DAY),
      });
      expect((await reconcileCalendar(new Date().toISOString())).ok).toBe(true);
      expect(eventsFor(await listAllCalendar(), instanceId)).toHaveLength(0);

      await seedInstance(chore.id, {
        instanceId,
        dueAt: iso(-1 * DAY),
        calendarEventId: eventId,
      });

      const sweep = await runSweep(new Date().toISOString());
      expect(sweep.ok).toBe(true);

      const instances = await instancesFor(chore.id);
      // Still exactly one row: the chore was not deleted, and it was not
      // re-materialised into a second occurrence either.
      expect(instances).toHaveLength(1);
      const row = rowFor(instances, instanceId);
      expect(String(row.scheduleState ?? "")).toBe("unscheduled");
      // The row must not keep claiming an event that is gone.
      expect(String(row.calendarEventId ?? "")).toBe("");

      // Nothing was re-created on the calendar. Deleting the event means "stop
      // telling me when this is due", not "ask me again in an hour".
      expect(eventsFor(await listAllCalendar(), instanceId)).toHaveLength(0);

      // The chore is still there, still live.
      const chores = await readTab("Chores");
      const live = chores.filter(
        (candidate) => String(candidate.id) === chore.id && String(candidate.deletedAt ?? "") === "",
      );
      expect(live).toHaveLength(1);

      // And so is the history.
      const completions = await readTab("Completions");
      expect(completions).toHaveLength(1);
      expect(String(completions[0].instanceId)).toBe(pastInstanceId);
      expect(String(completions[0].choreId)).toBe(chore.id);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "creates exactly one next event, one week out, when a weekly chore is completed",
    async () => {
      const chore = await seedChore(household.houseAssetId, {
        recurrenceUnit: "week",
        recurrenceN: 1,
        nextDueAt: iso(-1 * DAY),
      });
      const instanceId = await seedInstance(chore.id, { dueAt: iso(-1 * DAY) });

      const response = await complete({
        instanceId,
        choreId: chore.id,
        personId: household.personA.id,
        token: household.personA.token,
      });
      expect(response.ok).toBe(true);
      const completedAtMs = Date.parse(String(response.data?.completion?.completedAt));
      expect(Number.isFinite(completedAtMs)).toBe(true);

      // One open occurrence for this chore, and it is not the one just ticked off.
      const instances = await instancesFor(chore.id);
      expect(instances).toHaveLength(1);
      const next = instances[0];
      expect(String(next.instanceId)).not.toBe(instanceId);
      expectAbout(String(next.dueAt), completedAtMs + 7 * DAY, "the next occurrence's dueAt");

      // Exactly one event on the whole calendar: the old one is gone, and the
      // new one is a SINGLE event, not a recurring series.
      const events = await listAllCalendar();
      expect(events).toHaveLength(1);
      expect(events[0].instanceId).toBe(String(next.instanceId));
      expect(String(next.calendarEventId ?? "")).toBe(events[0].eventId);
      expectAbout(String(events[0].startAt), completedAtMs + 7 * DAY, "the next event's start");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "measures the next date from when the chore was DONE, not from when it was due",
    async () => {
      // The decision, stated as a test. A four-weekly chore done two weeks late
      // is next due four weeks from TODAY. If the server scheduled from the old
      // due date instead, the next one would land in two weeks — and a chore
      // done six weeks late would stack up six occurrences.
      const chore = await seedChore(household.houseAssetId, {
        title: "Clean the bathroom",
        recurrenceUnit: "week",
        recurrenceN: 4,
        nextDueAt: iso(-14 * DAY),
      });
      const instanceId = await seedInstance(chore.id, { dueAt: iso(-14 * DAY) });

      const response = await complete({
        instanceId,
        choreId: chore.id,
        personId: household.personB.id,
        token: household.personB.token,
      });
      expect(response.ok).toBe(true);
      const completedAtMs = Date.parse(String(response.data?.completion?.completedAt));

      const events = await listAllCalendar();
      expect(events).toHaveLength(1);
      const startMs = Date.parse(String(events[0].startAt));

      // Four weeks from the completion...
      expectAbout(String(events[0].startAt), completedAtMs + 28 * DAY, "the next event's start");

      // ...and emphatically NOT four weeks from the date it was originally due,
      // which would put it a fortnight from now.
      const fromOldDueDate = completedAtMs - 14 * DAY + 28 * DAY;
      expect(
        Math.abs(startMs - fromOldDueDate) > CLOSE_ENOUGH_MS,
        "the next event was scheduled from the old due date, not from the completion",
      ).toBe(true);

      const instances = await instancesFor(chore.id);
      expect(instances).toHaveLength(1);
      expectAbout(String(instances[0].dueAt), completedAtMs + 28 * DAY, "the next occurrence's dueAt");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "creates no second event, and moves no date, when the sweep runs twice",
    async () => {
      const chore = await seedChore(household.houseAssetId, { nextDueAt: iso(-1 * DAY) });

      const first = await runSweep(new Date().toISOString());
      expect(first.ok).toBe(true);

      const afterFirst = await instancesFor(chore.id);
      expect(afterFirst).toHaveLength(1);
      const instanceId = String(afterFirst[0].instanceId);
      const dueAtAfterFirst = String(afterFirst[0].dueAt);
      const eventIdAfterFirst = String(afterFirst[0].calendarEventId);
      const notifiedAfterFirst = String(afterFirst[0].lastNotifiedAt);
      expect(eventIdAfterFirst).not.toBe("");

      const second = await runSweep(new Date().toISOString());
      expect(second.ok).toBe(true);

      // The read-back must not mistake Google's second-precision echo of the
      // start time for somebody dragging the event.
      const afterSecond = await instancesFor(chore.id);
      expect(afterSecond).toHaveLength(1);
      expect(String(afterSecond[0].instanceId)).toBe(instanceId);
      expect(String(afterSecond[0].dueAt)).toBe(dueAtAfterFirst);
      expect(String(afterSecond[0].calendarEventId)).toBe(eventIdAfterFirst);
      expect(String(afterSecond[0].lastNotifiedAt)).toBe(notifiedAfterFirst);
      expect(String(afterSecond[0].scheduleState ?? "")).not.toBe("unscheduled");

      const events = await listAllCalendar();
      expect(events).toHaveLength(1);
      expect(eventsFor(events, instanceId)).toHaveLength(1);
      expect(events[0].eventId).toBe(eventIdAfterFirst);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "moves the pending event when the chore's due date is edited in the app",
    async () => {
      const chore = await seedChore(household.houseAssetId, { nextDueAt: iso(-1 * DAY) });
      expect((await runSweep(new Date().toISOString())).ok).toBe(true);

      const before = await instancesFor(chore.id);
      expect(before).toHaveLength(1);
      const instanceId = String(before[0].instanceId);

      const movedTo = Date.now() + 10 * DAY;
      const update = await call(
        "chore.update",
        { id: chore.id, nextDueAt: new Date(movedTo).toISOString() },
        { token: household.personA.token },
      );
      expect(update.ok).toBe(true);

      const events = eventsFor(await listAllCalendar(), instanceId);
      expect(events).toHaveLength(1);
      expectAbout(String(events[0].startAt), movedTo, "the pending event after the rule was edited");

      const after = rowFor(await instancesFor(chore.id), instanceId);
      expectAbout(String(after.dueAt), movedTo, "the instance dueAt after the rule was edited");
      expect(String(after.calendarEventId ?? "")).toBe(events[0].eventId);
    },
    TEST_TIMEOUT_MS,
  );
});
