import { test, expect } from "@playwright/test";
import { installFakeServer, seedCredentials, type SnapshotData } from "./support/fakeServer";

const DAY_MS = 86_400_000;

/**
 * Fairness by hand, from fairness.ts's own documented formula (never imported):
 * windowPoints = 40 (30 for p1 + 10 for p2), confidence = min(1, 40/20) = 1.
 * p1: share = 30/40 = 0.75, overload = max(0, 0.75/0.5 - 1) = 0.5, tier = 0.4
 *     (0.5 clears the 0.4 step but not the 0.6 one).
 * p2: share = 10/40 = 0.25, overload = max(0, 0.25/0.5 - 1) floors at 0, tier = 0.
 */
function fixture(): SnapshotData {
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  return {
    people: [
      { id: "p1", displayName: "Alice" },
      { id: "p2", displayName: "Bob" },
    ],
    assets: [{ id: "house", kind: "house", budget: "60" }],
    chores: [
      {
        id: "c1",
        title: "Wash the dishes",
        assetId: "house",
        weightTime: "2",
        weightEffort: "2",
        weightPriority: "2",
        recurrenceUnit: "day",
        recurrenceN: "1",
        nextDueAt: iso(-1),
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
    ],
    instances: [],
    completions: [
      { mutationId: "m1", instanceId: "i1", choreId: "c1", personId: "p1", completedAt: iso(2), pointsAwarded: "10", choreTitle: "Wash the dishes", assetId: "house" },
      { mutationId: "m2", instanceId: "i2", choreId: "c1", personId: "p1", completedAt: iso(3), pointsAwarded: "10", choreTitle: "Wash the dishes", assetId: "house" },
      { mutationId: "m3", instanceId: "i3", choreId: "c1", personId: "p1", completedAt: iso(4), pointsAwarded: "10", choreTitle: "Wash the dishes", assetId: "house" },
      { mutationId: "m4", instanceId: "i4", choreId: "c1", personId: "p2", completedAt: iso(5), pointsAwarded: "10", choreTitle: "Wash the dishes", assetId: "house" },
    ],
  };
}

test("tiers unchanged until approval", async ({ page }) => {
  await installFakeServer(page, { snapshot: fixture() });
  await seedCredentials(page, "p1");
  await page.goto("/");
  await page.getByTestId("nav-stats").click();

  const p1 = page.locator('[data-testid="stats-person"][data-person-id="p1"]');
  const p2 = page.locator('[data-testid="stats-person"][data-person-id="p2"]');
  await expect(p1).toHaveAttribute("data-tier", "0.4");
  await expect(p2).toHaveAttribute("data-tier", "0");

  // Snapshot the backlog/history before touching the reset at all, to compare later.
  const recentBefore = await page.getByTestId("stats-recent-row").allTextContents();
  const assetPointsBefore = await page.getByTestId("stats-asset-points").allTextContents();
  const assetCompletionsBefore = await page.getByTestId("stats-asset-completions").allTextContents();
  await page.getByTestId("nav-chores").click();
  const choreCountBefore = await page.getByTestId("chore-row").count();
  await page.getByTestId("nav-stats").click();

  await expect(page.getByTestId("reset-propose")).toBeVisible();
  await page.getByTestId("reset-propose").click();

  // Every person's tier is byte-for-byte what it was before the proposal.
  await expect(page.getByTestId("reset-state")).toHaveAttribute("data-state", "proposed");
  await expect(p1).toHaveAttribute("data-tier", "0.4");
  await expect(p2).toHaveAttribute("data-tier", "0");
  // The proposer cannot approve their own proposal.
  await expect(page.getByTestId("reset-approve")).toHaveCount(0);
  await expect(page.getByTestId("reset-propose")).toHaveCount(0);

  // Switch which person this device is acting as -- the reset handshake is explicitly
  // device-local, not account-local, so this is how "the other person" approves on one
  // shared device.
  await page.evaluate(() => {
    const raw = window.localStorage.getItem("house.credentials");
    const creds = JSON.parse(raw as string);
    window.localStorage.setItem("house.credentials", JSON.stringify({ ...creds, personId: "p2" }));
  });
  // Re-seed as p2. `seedCredentials` installs an init script that re-runs on EVERY
  // navigation, so without this it would overwrite the line above and put the device
  // back to p1 before the app boots -- and p1 correctly cannot approve their own
  // proposal.
  await seedCredentials(page, "p2");
  await page.reload();
  await page.getByTestId("nav-stats").click();

  await expect(page.getByTestId("reset-approve")).toBeVisible();
  await page.getByTestId("reset-approve").click();

  await expect(page.getByTestId("reset-state")).toHaveAttribute("data-state", "approved");

  // The tiers DID change: the window is cleared, so both come back to neutral.
  const p1After = page.locator('[data-testid="stats-person"][data-person-id="p1"]');
  const p2After = page.locator('[data-testid="stats-person"][data-person-id="p2"]');
  await expect(p1After).toHaveAttribute("data-tier", "0");
  await expect(p2After).toHaveAttribute("data-tier", "0");

  // ...but the chores, instances and completions on screen did not.
  const recentAfter = await page.getByTestId("stats-recent-row").allTextContents();
  const assetPointsAfter = await page.getByTestId("stats-asset-points").allTextContents();
  const assetCompletionsAfter = await page.getByTestId("stats-asset-completions").allTextContents();
  expect(recentAfter).toEqual(recentBefore);
  expect(assetPointsAfter).toEqual(assetPointsBefore);
  expect(assetCompletionsAfter).toEqual(assetCompletionsBefore);

  await page.getByTestId("nav-chores").click();
  await expect(page.getByTestId("chore-row")).toHaveCount(choreCountBefore);
});
