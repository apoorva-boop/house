// Flows 31 to 35 and 14 — the Calendar lifecycle, and what survives a delete.
// Integration AC 5, 6 and 7. Issue #2 acceptance 5 and 6.
//
// Calendar is the STOP-LOSS for the whole project: if Declarative Web Push never
// works, this is the notification channel that ships. So the lifecycle has to be
// airtight, and an orphaned event — one whose chore or instance is gone — is a
// reminder for work nobody can tick off.
//
// Every event carries the instance id as an event tag, written with `setTag` and
// read back with `getTag`. That tag is the only thing that makes an orphan
// findable: without it a crashed run leaves an event that nothing can ever match
// back to a row. Which extended-properties namespace `setTag` uses is not
// documented and has not been verified — it does not matter here, because these
// events have no guests.

import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  call,
  clearAll,
  complete,
  completionsFor,
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
  TEST_TIMEOUT_MS,
  type CalendarEvent,
  type Household,
  type SeededChore,
} from "./testkit.js";

/**
 * The invariant the whole channel exists to keep: every tagged event on the
 * calendar belongs to a live instance, and that instance's row points back at it.
 * A stranded event fails the first check; a lost id fails the second.
 */
async function expectNoStrandedEvents(): Promise<void> {
  const instances = await readTab("Instances");
  const live = new Map(
    instances.map((row) => [String(row.instanceId), String(row.calendarEventId ?? "")]),
  );
  const events = await listAllCalendar();
  const byEventId = new Map(events.map((event) => [event.eventId, event]));

  for (const event of events) {
    expect(
      live.has(event.instanceId),
      `calendar event ${event.eventId} is tagged with instanceId ${event.instanceId}, which has no Instances row`,
    ).toBe(true);
    expect(live.get(event.instanceId)).toBe(event.eventId);
  }

  // The other direction, and the reason this helper is worth calling. The loop above
  // iterates the calendar, so on an empty calendar it asserts nothing at all and passes
  // against a server that deletes every event and schedules none. Every Instances row
  // that CLAIMS an event must have that event, at that id, tagged back to it.
  const claimed = [...live.entries()].filter(([, eventId]) => eventId !== "");
  for (const [instanceId, eventId] of claimed) {
    const event = byEventId.get(eventId);
    expect(
      event,
      `Instances row ${instanceId} claims calendar event ${eventId}, which is not on the calendar`,
    ).toBeDefined();
    expect(event?.instanceId).toBe(instanceId);
  }

  // And nothing beyond those: the two sides are a bijection, not an overlap.
  expect(
    events.map((event) => event.eventId).sort(),
    "the calendar and the Instances rows must name exactly the same set of events",
  ).toEqual(claimed.map(([, eventId]) => eventId).sort());
}

/** Seeds an overdue chore and sweeps it into an instance with a calendar event. */
async function overdueWithEvent(
  household: Household,
): Promise<{ chore: SeededChore; instanceId: string; event: CalendarEvent }> {
  const chore = await seedChore(household.houseAssetId, { nextDueAt: iso(-1 * DAY) });
  const sweep = await runSweep(new Date().toISOString());
  expect(sweep.ok).toBe(true);

  const instances = await instancesFor(chore.id);
  expect(instances).toHaveLength(1);
  const instanceId = String(instances[0].instanceId);

  const events = eventsFor(await listAllCalendar(), instanceId);
  expect(events).toHaveLength(1);
  return { chore, instanceId, event: events[0] };
}

describe("calendar channel", () => {
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
    "creates a tagged event and persists calendarEventId to the sheet at creation",
    async () => {
      const chore = await seedChore(household.houseAssetId, { nextDueAt: iso(-1 * DAY) });

      const sweep = await runSweep(new Date().toISOString());
      expect(sweep.ok).toBe(true);

      const instances = await instancesFor(chore.id);
      expect(instances).toHaveLength(1);
      const instanceId = String(instances[0].instanceId);
      const persistedEventId = String(instances[0].calendarEventId);

      const events = eventsFor(await listAllCalendar(), instanceId);
      expect(events).toHaveLength(1);
      expect(events[0].instanceId).toBe(instanceId);

      // The id is on the sheet BEFORE anything ever tries to delete the event.
      // If it were written only at delete time, a crash in between would leave an
      // event nothing can find. Reading it now, with no delete yet issued, is
      // what proves the write happens at creation.
      expect(persistedEventId).not.toBe("");
      expect(persistedEventId).toBe(events[0].eventId);

      await expectNoStrandedEvents();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "removes the event and clears calendarEventId when the chore is completed",
    async () => {
      const { chore, instanceId } = await overdueWithEvent(household);

      const response = await complete({
        instanceId,
        choreId: chore.id,
        personId: household.personA.id,
        token: household.personA.token,
      });
      expect(response.ok).toBe(true);

      expect(eventsFor(await listAllCalendar(), instanceId)).toHaveLength(0);

      const instances = await instancesFor(chore.id);
      const completed = instances.find((row) => String(row.instanceId) === instanceId);
      // The row may be closed out or removed, but it must not still claim an event.
      if (completed) expect(String(completed.calendarEventId)).toBe("");

      await expectNoStrandedEvents();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "removes the event when the chore is deleted",
    async () => {
      const { chore, instanceId } = await overdueWithEvent(household);

      const response = await call("chore.delete", { id: chore.id }, { token: household.personA.token });
      expect(response.ok).toBe(true);

      expect(eventsFor(await listAllCalendar(), instanceId)).toHaveLength(0);
      await expectNoStrandedEvents();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "strands no event when a chore's due date is changed",
    async () => {
      const { chore, instanceId, event } = await overdueWithEvent(household);
      const originalEventId = event.eventId;
      const newDueAt = iso(21 * DAY);

      const response = await call("chore.update", { id: chore.id, nextDueAt: newDueAt }, { token: household.personA.token });
      expect(response.ok).toBe(true);

      // Whether the channel moves the event or deletes and recreates it is its
      // business. What must never happen is the old event outliving the old date.
      const events = await listAllCalendar();
      const survivors = events.filter((candidate) => candidate.eventId === originalEventId);
      if (survivors.length > 0) {
        // Moved: same event, new time, still tagged to a live instance.
        expect(survivors[0].startAt).not.toBe(event.startAt);
      } else {
        // Recreated: the old instance keeps no dangling id.
        const stale = eventsFor(events, instanceId).filter((e) => e.eventId === originalEventId);
        expect(stale).toHaveLength(0);
      }

      // The branch above only says the OLD event is gone or moved, which a server that
      // deleted the event and scheduled nothing would also satisfy. So assert the
      // positive: the chore still has exactly one live reminder, and it sits at the new
      // date. This holds whichever branch was taken.
      const liveInstances = await instancesFor(chore.id);
      const reminders = liveInstances.flatMap((row) => eventsFor(events, String(row.instanceId)));
      expect(reminders).toHaveLength(1);

      const startAt = reminders[0].startAt;
      expect(startAt, "the surviving reminder must carry a start time").toBeTruthy();
      // The channel writes the event start from the row's dueAt; Google stores it to the
      // second, so allow the same one-minute slack the sweep's own drift check allows.
      // The old date is 22 days away from the new one, so this cannot pass by accident.
      expect(Math.abs(Date.parse(String(startAt)) - Date.parse(newDueAt))).toBeLessThan(60_000);
      expect(startAt).not.toBe(event.startAt);

      await expectNoStrandedEvents();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "sweeps a tagged event whose instance no longer exists, and spares one that does",
    async () => {
      // A live instance with its event, so reconcile has something it must NOT delete.
      const { instanceId: liveInstanceId } = await overdueWithEvent(household);

      // The post-crash state: the Instances row is gone, the tagged event is not.
      const orphanInstanceId = newId();
      const orphanEventId = await createTaggedEvent({
        instanceId: orphanInstanceId,
        title: "Orphaned reminder",
        startAt: iso(-1 * DAY),
      });
      expect(eventsFor(await listAllCalendar(), orphanInstanceId)).toHaveLength(1);

      const response = await reconcileCalendar(new Date().toISOString());
      expect(response.ok).toBe(true);

      const events = await listAllCalendar();
      expect(events.map((event) => event.eventId)).not.toContain(orphanEventId);
      expect(eventsFor(events, orphanInstanceId)).toHaveLength(0);

      // Reconcile must be a scalpel, not a bulldozer.
      expect(eventsFor(events, liveInstanceId)).toHaveLength(1);

      await expectNoStrandedEvents();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "retains completions with choreTitle and assetId when the chore is deleted",
    async () => {
      const { chore, instanceId } = await overdueWithEvent(household);

      const done = await complete({
        instanceId,
        choreId: chore.id,
        personId: household.personB.id,
        token: household.personB.token,
      });
      expect(done.ok).toBe(true);
      expect(await completionsFor(instanceId)).toHaveLength(1);

      const deleted = await call("chore.delete", { id: chore.id }, { token: household.personA.token });
      expect(deleted.ok).toBe(true);

      // The chore is gone from the list...
      const chores = await readTab("Chores");
      const remaining = chores.filter(
        (row) => String(row.id) === chore.id && String(row.deletedAt ?? "") === "",
      );
      expect(remaining).toHaveLength(0);

      // ...but the history survives, and stats can still name what was done and
      // where, because title and asset were snapshotted onto the completion row.
      const completions = await completionsFor(instanceId);
      expect(completions).toHaveLength(1);
      expect(String(completions[0].choreTitle)).toBe(chore.title);
      expect(String(completions[0].assetId)).toBe(household.houseAssetId);
      expect(Number(completions[0].pointsAwarded)).toBe(chore.expectedPoints);
      expect(String(completions[0].personId)).toBe(household.personB.id);
    },
    TEST_TIMEOUT_MS,
  );
});
