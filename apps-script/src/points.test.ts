// Flow 6, server half — points are the server's business, not the client's.
// Integration AC 3. Issue #2 acceptance 3.
//
// `pointsAwarded` must be computed inside the lock from the CURRENT `Chores` row.
// A client that posts a number gets the server's number back. Trusting the client
// would let a phone with a stale chore, a bug, or bad intent set its own score.
//
// The rule is clamp(round(2*time + 2*effort + 3*priority), 5, 35) on a 1-5 slider
// domain, so all-minimum is 7 and all-maximum is 35.

import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  clearAll,
  complete,
  completionsFor,
  requireIntegrationEnv,
  seedChore,
  seedHousehold,
  seedInstance,
  TEST_TIMEOUT_MS,
  type Household,
} from "./testkit.js";

describe("server-side points", () => {
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
    "returns the server's points, not the client's, when the client posts a wrong value",
    async () => {
      const chore = await seedChore(household.houseAssetId, {
        weightTime: 1,
        weightEffort: 1,
        weightPriority: 1,
      });
      expect(chore.expectedPoints).toBe(7);
      const instanceId = await seedInstance(chore.id);

      const response = await complete({
        instanceId,
        choreId: chore.id,
        personId: household.personA.id,
        token: household.personA.token,
        pointsAwarded: 9999, // deliberately wrong
      });

      expect(response.ok).toBe(true);
      expect(Number(response.data?.completion?.pointsAwarded)).toBe(7);
      expect(Number(response.data?.completion?.pointsAwarded)).not.toBe(9999);

      const rows = await completionsFor(instanceId);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].pointsAwarded)).toBe(7);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "computes points from the chore row for a heavy chore too",
    async () => {
      // A single hardcoded answer can be satisfied by a constant. Two different
      // weightings on the same code path cannot.
      const chore = await seedChore(household.houseAssetId, {
        weightTime: 5,
        weightEffort: 5,
        weightPriority: 5,
      });
      expect(chore.expectedPoints).toBe(35);
      const instanceId = await seedInstance(chore.id);

      const response = await complete({
        instanceId,
        choreId: chore.id,
        personId: household.personB.id,
        token: household.personB.token,
        pointsAwarded: 1,
      });

      expect(response.ok).toBe(true);
      expect(Number(response.data?.completion?.pointsAwarded)).toBe(35);

      const rows = await completionsFor(instanceId);
      expect(Number(rows[0].pointsAwarded)).toBe(35);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "awards points when the client sends none at all",
    async () => {
      const chore = await seedChore(household.houseAssetId, {
        weightTime: 3,
        weightEffort: 2,
        weightPriority: 4,
      });
      expect(chore.expectedPoints).toBe(22); // 6 + 4 + 12
      const instanceId = await seedInstance(chore.id);

      const response = await complete({
        instanceId,
        choreId: chore.id,
        personId: household.personA.id,
        token: household.personA.token,
      });

      expect(response.ok).toBe(true);
      expect(Number(response.data?.completion?.pointsAwarded)).toBe(22);
    },
    TEST_TIMEOUT_MS,
  );
});
