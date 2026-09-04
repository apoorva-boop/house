// Flows 8 and 9 — a double-tapped tick, and an offline queue flushed twice.
// Integration AC 2. Issue #2 acceptance 2.
//
// `mutationId` is minted at ENQUEUE, never at POST, so a replayed flush sends the
// same IDs again. Dedupe on `mutationId` is what makes that replay harmless.

import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  clearAll,
  complete,
  completionsFor,
  newId,
  readTab,
  requireIntegrationEnv,
  seedChore,
  seedHousehold,
  seedInstance,
  TEST_TIMEOUT_MS,
  type Household,
} from "./testkit.js";

describe("dedupe", () => {
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
    "writes one row when the same mutationId is posted twice",
    async () => {
      const chore = await seedChore(household.houseAssetId);
      const instanceId = await seedInstance(chore.id);
      const mutationId = newId();

      const first = await complete({
        instanceId,
        choreId: chore.id,
        personId: household.personA.id,
        token: household.personA.token,
        mutationId,
      });
      const second = await complete({
        instanceId,
        choreId: chore.id,
        personId: household.personA.id,
        token: household.personA.token,
        mutationId,
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      const rows = await completionsFor(instanceId);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].mutationId)).toBe(mutationId);

      // The replay gets the row that already exists, not a new one and not an error.
      expect(String(second.data?.completion?.mutationId)).toBe(mutationId);
      expect(String(second.data?.completion?.completedAt)).toBe(
        String(first.data?.completion?.completedAt),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "is idempotent when a whole offline queue is flushed twice",
    async () => {
      const chore = await seedChore(household.houseAssetId);
      const queue: Array<{ instanceId: string; mutationId: string }> = [];
      for (let i = 0; i < 3; i += 1) {
        queue.push({ instanceId: await seedInstance(chore.id), mutationId: newId() });
      }

      const flush = async () => {
        // Strict FIFO, as the client's MutationQueue sends it.
        for (const item of queue) {
          const response = await complete({
            instanceId: item.instanceId,
            choreId: chore.id,
            personId: household.personB.id,
            token: household.personB.token,
            mutationId: item.mutationId,
          });
          expect(response.ok).toBe(true);
        }
      };

      await flush();
      const afterFirst = await readTab("Completions");
      await flush();
      const afterSecond = await readTab("Completions");

      expect(afterFirst).toHaveLength(3);
      expect(afterSecond).toHaveLength(3);

      const idsAfterFirst = afterFirst.map((row) => String(row.mutationId)).sort();
      const idsAfterSecond = afterSecond.map((row) => String(row.mutationId)).sort();
      expect(idsAfterSecond).toEqual(idsAfterFirst);
      expect(idsAfterSecond).toEqual(queue.map((item) => item.mutationId).sort());

      // Points must not accumulate on replay either — the row is untouched.
      const pointsAfterFirst = afterFirst.map((row) => Number(row.pointsAwarded));
      const pointsAfterSecond = afterSecond.map((row) => Number(row.pointsAwarded));
      expect(pointsAfterSecond).toEqual(pointsAfterFirst);
    },
    TEST_TIMEOUT_MS,
  );
});
