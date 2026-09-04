// Flows 30 and 43 — instance materialisation, and duplicate alert prevention.
// Integration AC 8 and 9. Issue #2 acceptance 7 and 8.
//
// `DueSweep` is the SOLE owner of instance materialisation. It runs on a
// time-driven trigger whose granularity is honoured only to about +/- 15 minutes,
// so overlapping windows are normal and the sweep must be idempotent.
//
// The re-notify gate must be `lastNotifiedAt` on the Instances row. Calendar and
// push `Topic` coalescing only suppresses messages that have NOT been delivered
// yet — once the first alert lands on the phone, a second one is a new message
// and coalescing does nothing to stop it.

import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  clearAll,
  DAY,
  eventsFor,
  instancesFor,
  iso,
  listAllCalendar,
  readTab,
  requireIntegrationEnv,
  runSweep,
  seedChore,
  seedHousehold,
  TEST_TIMEOUT_MS,
  updateRows,
  type Household,
} from "./testkit.js";

describe("due sweep", () => {
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
    "creates one instance when run twice over the same window",
    async () => {
      const chore = await seedChore(household.houseAssetId, { nextDueAt: iso(-1 * DAY) });
      const now = new Date().toISOString();

      const first = await runSweep(now);
      const second = await runSweep(now);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      const instances = await instancesFor(chore.id);
      expect(instances).toHaveLength(1);

      // The first run owns the creation; the second must claim nothing.
      expect(first.data?.created ?? []).toContain(String(instances[0].instanceId));
      expect(second.data?.created ?? []).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "materialises only the chore that is due, not the one that is not",
    async () => {
      // Both chores live in the same sweep window, so the ONLY thing that can
      // separate them is the due date. A negative on its own would also pass
      // against a sweep that does nothing at all, which proves nothing.
      const due = await seedChore(household.houseAssetId, {
        title: "Due chore",
        nextDueAt: iso(-1 * DAY),
      });
      const notDue = await seedChore(household.houseAssetId, {
        title: "Not-yet-due chore",
        nextDueAt: iso(30 * DAY),
      });

      const response = await runSweep(new Date().toISOString());
      expect(response.ok).toBe(true);

      // Exactly one row across the whole tab: not zero (nothing ran), and not
      // two (everything materialised regardless of when it is due).
      const allInstances = await readTab("Instances");
      expect(allInstances).toHaveLength(1);
      expect(String(allInstances[0].choreId)).toBe(due.id);

      expect(await instancesFor(due.id)).toHaveLength(1);
      expect(await instancesFor(notDue.id)).toHaveLength(0);

      const created = response.data?.created ?? [];
      expect(created).toHaveLength(1);
      expect(created).toContain(String(allInstances[0].instanceId));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "does not re-notify on a second sweep once a reminder has been delivered",
    async () => {
      const chore = await seedChore(household.houseAssetId, { nextDueAt: iso(-1 * DAY) });

      const first = await runSweep(new Date().toISOString());
      expect(first.ok).toBe(true);

      const afterFirst = await instancesFor(chore.id);
      expect(afterFirst).toHaveLength(1);
      const instanceId = String(afterFirst[0].instanceId);
      const firstNotifiedAt = String(afterFirst[0].lastNotifiedAt);

      // The sweep must record that it alerted, or nothing can gate the next run.
      expect(first.data?.notified ?? []).toContain(instanceId);
      expect(firstNotifiedAt).not.toBe("");

      // Repeat-nag is off by default, so an hour later there must be no second alert.
      const second = await runSweep(new Date(Date.now() + 3_600_000).toISOString());
      expect(second.ok).toBe(true);
      expect(second.data?.notified ?? []).not.toContain(instanceId);

      const afterSecond = await instancesFor(chore.id);
      expect(afterSecond).toHaveLength(1);
      expect(String(afterSecond[0].lastNotifiedAt)).toBe(firstNotifiedAt);

      // And no second calendar alert was manufactured either.
      const events = eventsFor(await listAllCalendar(), instanceId);
      expect(events).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "stays silent for an instance whose snooze has not expired",
    async () => {
      const chore = await seedChore(household.houseAssetId, { nextDueAt: iso(-1 * DAY) });
      const first = await runSweep(new Date().toISOString());
      expect(first.ok).toBe(true);

      const instances = await instancesFor(chore.id);
      const instanceId = String(instances[0].instanceId);

      // Clear the notified stamp and snooze it, so only the snooze can gate the run.
      await clearInstanceNotification(instanceId);

      const second = await runSweep(new Date().toISOString());
      expect(second.ok).toBe(true);
      expect(second.data?.notified ?? []).not.toContain(instanceId);
    },
    TEST_TIMEOUT_MS,
  );
});

/**
 * Rewrites the instance so it looks un-notified but snoozed. Uses the raw
 * test-support update, because the point is to isolate the snooze gate from the
 * `lastNotifiedAt` gate — if the test left both set, either one passing would do.
 */
async function clearInstanceNotification(instanceId: string): Promise<void> {
  const rows = await readTab("Instances");
  const target = rows.find((row) => String(row.instanceId) === instanceId);
  if (!target) throw new Error(`Instance ${instanceId} not found — sweep did not create it`);
  await updateRows("Instances", "instanceId", [
    { ...target, lastNotifiedAt: "", snoozedUntil: iso(2 * DAY) },
  ]);
}
