// Flow 10 and 11 — two devices ticking the same chore, and lock contention.
// Integration AC 1. Issue #2 acceptance 1.
//
// The first test here is the most important in this pull request. `mutationId`
// dedupe alone does NOT prevent a double write: two phones mint two different
// mutation IDs for the same chore occurrence. Only an `instanceId` uniqueness
// check inside `getScriptLock()` prevents it. A `mutationId`-only implementation
// passes every single-device test and fails only when both people tick at once —
// which is the bug this project is most likely to ship.

import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  clearAll,
  complete,
  completionsFor,
  readTab,
  requireIntegrationEnv,
  seedChore,
  seedHousehold,
  seedInstance,
  TEST_TIMEOUT_MS,
  type Household,
} from "./testkit.js";

describe("concurrency", () => {
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
    "writes one row when two devices tick the same occurrence with different mutationIds",
    async () => {
      const chore = await seedChore(household.houseAssetId);
      const instanceId = await seedInstance(chore.id);

      // Two devices, two independently minted mutation IDs, one occurrence.
      const [first, second] = await Promise.all([
        complete({
          instanceId,
          choreId: chore.id,
          personId: household.personA.id,
          token: household.personA.token,
        }),
        complete({
          instanceId,
          choreId: chore.id,
          personId: household.personB.id,
          token: household.personB.token,
        }),
      ]);

      const rows = await completionsFor(instanceId);
      expect(rows).toHaveLength(1);

      // Neither caller is told it failed. The second is told who got there first.
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      const responses = [first, second];
      const losers = responses.filter((r) => r.data?.alreadyCompletedBy !== undefined);
      expect(losers).toHaveLength(1);

      const winnerPersonId = String(rows[0].personId);
      expect([household.personA.id, household.personB.id]).toContain(winnerPersonId);
      expect(losers[0].data?.alreadyCompletedBy).toBe(winnerPersonId);

      // Both callers get the same authoritative row back, so neither client's
      // optimistic state diverges from the sheet.
      for (const response of responses) {
        expect(response.data?.completion).toBeDefined();
        expect(String(response.data?.completion?.instanceId)).toBe(instanceId);
        expect(String(response.data?.completion?.personId)).toBe(winnerPersonId);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "never reports success for a write that did not land, under lock contention",
    async () => {
      // Six distinct occurrences fired at once, so the script lock is genuinely
      // contended and some callers may legitimately lose it. Whatever happens,
      // ok:true must mean a row exists and ok:false must mean none does.
      const chore = await seedChore(household.houseAssetId);
      const instanceIds: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        instanceIds.push(await seedInstance(chore.id));
      }

      const responses = await Promise.all(
        instanceIds.map((instanceId, index) =>
          complete({
            instanceId,
            choreId: chore.id,
            personId: index % 2 === 0 ? household.personA.id : household.personB.id,
            token: index % 2 === 0 ? household.personA.token : household.personB.token,
          }),
        ),
      );

      const written = await readTab("Completions");
      const writtenInstanceIds = new Set(written.map((row) => String(row.instanceId)));

      responses.forEach((response, index) => {
        const instanceId = instanceIds[index];
        if (response.ok) {
          // Claimed success — the row must be there.
          expect(writtenInstanceIds.has(instanceId)).toBe(true);
        } else {
          // Reported failure — nothing may have been written, and the client
          // needs a message to retry against, not a silent false.
          expect(writtenInstanceIds.has(instanceId)).toBe(false);
          expect(response.error).toBeTruthy();
        }
      });

      // No occurrence may be written twice even when every request overlaps.
      expect(writtenInstanceIds.size).toBe(written.length);
    },
    TEST_TIMEOUT_MS,
  );
});
