// Flows 3 and 4 — a wrong token, and no token at all.
// Integration AC 4. Issue #2 acceptance 4.
//
// The web app runs "execute as me / anyone", so the person token IS the whole
// access control. A token check that runs after the write is not a check.

import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  clearAll,
  newId,
  postEnvelope,
  readTab,
  requireIntegrationEnv,
  seedChore,
  seedHousehold,
  seedInstance,
  TEST_TIMEOUT_MS,
  type Household,
} from "./testkit.js";

describe("auth", () => {
  let household: Household;
  let choreId: string;
  let instanceId: string;

  beforeAll(() => {
    requireIntegrationEnv();
  });

  beforeEach(async () => {
    await clearAll();
    household = await seedHousehold();
    const chore = await seedChore(household.houseAssetId);
    choreId = chore.id;
    instanceId = await seedInstance(choreId);
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await clearAll();
  }, TEST_TIMEOUT_MS);

  it(
    "rejects an unknown token and writes nothing",
    async () => {
      const response = await postEnvelope<{ completion?: unknown }>({
        token: `not-a-real-token-${newId()}`,
        op: "complete",
        mutationId: newId(),
        payload: {
          instanceId,
          choreId,
          personId: household.personA.id,
          completedAt: new Date().toISOString(),
        },
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBeTruthy();
      expect(response.data).toBeUndefined();

      // Nothing written anywhere — not a completion row, not an instance mutation.
      expect(await readTab("Completions")).toHaveLength(0);
      const instances = await readTab("Instances");
      expect(instances).toHaveLength(1);
      expect(String(instances[0].instanceId)).toBe(instanceId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects a request with no token at all",
    async () => {
      const response = await postEnvelope({
        op: "complete",
        mutationId: newId(),
        payload: {
          instanceId,
          choreId,
          personId: household.personA.id,
          completedAt: new Date().toISOString(),
        },
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBeTruthy();
      expect(await readTab("Completions")).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects an empty token rather than treating it as absent-and-allowed",
    async () => {
      const response = await postEnvelope({
        token: "",
        op: "complete",
        mutationId: newId(),
        payload: {
          instanceId,
          choreId,
          personId: household.personA.id,
          completedAt: new Date().toISOString(),
        },
      });

      expect(response.ok).toBe(false);
      expect(await readTab("Completions")).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses the test-support backdoor to a caller without the test token",
    async () => {
      // `test.*` ops read and write raw rows. They must be gated as tightly as the
      // production ops, or the suite has installed a hole in the real deployment.
      const response = await postEnvelope({
        token: household.personA.token,
        op: "test.read",
        mutationId: newId(),
        payload: { tab: "Completions" },
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBeTruthy();
    },
    TEST_TIMEOUT_MS,
  );
});
