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
  TIME_ZONE,
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
    "tells each caller which person they are, and never hands out a token",
    async () => {
      // The snapshot is where a device learns its own identity. It cannot work it out
      // from `people`, which carries no `token` column on purpose — publishing the other
      // person's token to every device would make the one access control this
      // deployment has meaningless. So `me` is the whole answer, and it has to be the
      // person the TOKEN names, not anything the caller asked for.
      const asA = await postEnvelope<{ me?: string; people?: Record<string, unknown>[] }>({
        token: household.personA.token,
        op: "snapshot",
        mutationId: "",
        payload: {},
      });
      expect(asA.ok).toBe(true);
      expect(asA.data?.me).toBe(household.personA.id);

      // The same request on the other person's token resolves to the other person. One
      // deployment, one sheet, two answers — which is what makes this a fact about the
      // token rather than about the household.
      const asB = await postEnvelope<{ me?: string }>({
        token: household.personB.token,
        op: "snapshot",
        mutationId: "",
        payload: {},
      });
      expect(asB.ok).toBe(true);
      expect(asB.data?.me).toBe(household.personB.id);

      // The matching absence: no token reaches the client on any row.
      for (const person of asA.data?.people ?? []) {
        expect(person).not.toHaveProperty("token");
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reports the household time zone from Meta, not the server's own",
    async () => {
      // `seedHousehold` writes `Meta.timeZone = Pacific/Auckland`. The client needs it
      // because every domain rule takes the zone explicitly: without it the browser
      // falls back to whatever the phone is set to, and the same chore reads overdue on
      // one device and not on the other.
      const response = await postEnvelope<{ timeZone?: string }>({
        token: household.personA.token,
        op: "snapshot",
        mutationId: "",
        payload: {},
      });

      expect(response.ok).toBe(true);
      expect(response.data?.timeZone).toBe(TIME_ZONE);
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
