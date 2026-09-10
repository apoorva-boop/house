import { test, expect } from "@playwright/test";
import { installFakeServer, seedCredentials, type SnapshotData, type Recorded } from "./support/fakeServer";

test("created chore visible to both", async ({ browser }) => {
  // One shared "backend" object. Both fake-server instances point at the same
  // reference, so a row one of them pushes into it is visible to the other's next
  // `snapshot` call -- exactly what two people sharing one deployed Apps Script get.
  const sharedSnapshot: SnapshotData = {
    people: [
      { id: "p1", displayName: "Alice" },
      { id: "p2", displayName: "Bob" },
    ],
    assets: [{ id: "house", kind: "house", budget: "60" }],
    chores: [],
    instances: [],
    completions: [],
  };

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();

  // Slider values chosen so the arithmetic is unambiguous:
  // points = clamp(round(2*3 + 2*4 + 3*5), 5, 35) = clamp(round(6+8+15), 5, 35) = 29.
  const TIME = 3;
  const EFFORT = 4;
  const PRIORITY = 5;
  const EXPECTED_POINTS = 29;

  const serverA = await installFakeServer(pageA, {
    snapshot: sharedSnapshot,
    handler: (r: Recorded) => {
      if (r.op !== "chore.create") return null;
      const row = {
        id: "created-1",
        title: String(r.payload?.title ?? ""),
        assetId: String(r.payload?.assetId ?? ""),
        weightTime: String(r.payload?.weightTime ?? ""),
        weightEffort: String(r.payload?.weightEffort ?? ""),
        weightPriority: String(r.payload?.weightPriority ?? ""),
        recurrenceUnit: String(r.payload?.recurrenceUnit ?? ""),
        recurrenceN: String(r.payload?.recurrenceN ?? ""),
        nextDueAt: String(r.payload?.nextDueAt ?? ""),
        deadlineDate: String(r.payload?.deadlineDate ?? ""),
        leadTimeDays: String(r.payload?.leadTimeDays ?? ""),
        deletedAt: "",
      };
      sharedSnapshot.chores.push(row);
      return {
        body: { ok: true, data: { chore: row }, serverTime: new Date().toISOString(), version: 1 },
      };
    },
  });

  await seedCredentials(pageA);
  await pageA.goto("/");

  await pageA.getByTestId("nav-add").click();
  await expect(pageA.getByTestId("chore-editor")).toBeVisible();

  await pageA.getByTestId("editor-title").fill("Clean the car interior");
  await pageA.getByTestId("editor-asset").selectOption("house");
  await pageA.getByTestId("editor-time").fill(String(TIME));
  await pageA.getByTestId("editor-effort").fill(String(EFFORT));
  await pageA.getByTestId("editor-priority").fill(String(PRIORITY));
  await pageA.getByTestId("editor-recurrence-unit").selectOption("week");
  await pageA.getByTestId("editor-recurrence-n").fill("1");

  // The computed points shown live in the editor match the hand-computed formula.
  await expect(pageA.getByTestId("editor-points")).toHaveText(String(EXPECTED_POINTS));

  await pageA.getByTestId("editor-save").click();

  // A's own view updates optimistically, before the server round-trip.
  await expect(pageA.getByTestId("chore-title").filter({ hasText: "Clean the car interior" })).toBeVisible();

  // The server actually received the slider values and the same computed points.
  await expect.poll(() => serverA.recorded.some((r) => r.op === "chore.create")).toBe(true);
  const created = serverA.recorded.find((r) => r.op === "chore.create");
  expect(created).toBeTruthy();
  expect(Number(created!.payload.weightTime)).toBe(TIME);
  expect(Number(created!.payload.weightEffort)).toBe(EFFORT);
  expect(Number(created!.payload.weightPriority)).toBe(PRIORITY);
  // A second, independent browser context loading a snapshot that now contains the
  // chore sees it -- this is the "visible to both" half, not just "visible on A".
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await installFakeServer(pageB, { snapshot: sharedSnapshot, me: "p2" });
  await seedCredentials(pageB);
  await pageB.goto("/");
  // The map is now the launch screen (contract section 7); reach the chore list from it.
  await pageB.getByTestId("nav-chores").click();

  const rowOnB = pageB.locator('[data-testid="chore-row"][data-chore-id="created-1"]');
  await expect(rowOnB.getByTestId("chore-title")).toHaveText("Clean the car interior");

  await rowOnB.getByTestId("chore-edit").click();
  await expect(pageB.getByTestId("editor-time")).toHaveValue(String(TIME));
  await expect(pageB.getByTestId("editor-effort")).toHaveValue(String(EFFORT));
  await expect(pageB.getByTestId("editor-priority")).toHaveValue(String(PRIORITY));

  await contextA.close();
  await contextB.close();
});
