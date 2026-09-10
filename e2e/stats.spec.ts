import { test, expect } from "@playwright/test";
import { installFakeServer, seedCredentials, type SnapshotData } from "./support/fakeServer";

const DAY_MS = 86_400_000;

/**
 * Fairness window is 30 days (fairness.ts). One completion (m2) sits at 40 days old,
 * outside the window, on purpose: it must still count toward all-time asset points and
 * completion counts, but must be excluded from windowPoints and share.
 *
 * windowPoints = 10 (m1) + 20 (m3) = 30.
 * p1 window points = 10, share = 10/30 = 33% (rounded).
 * p2 window points = 20, share = 20/30 = 67% (rounded).
 * confidence = min(1, 30/20) = 1.
 * p1 overload = max(0, 0.333/0.5 - 1) floors at 0 -> tier 0.
 * p2 overload = max(0, 0.667/0.5 - 1) = 0.333 -> tier 0.2 (clears 0.2, not 0.4).
 *
 * All-time: house (c1) points = 10 + 10 = 20 over 2 completions.
 *           garden (c2) points = 20 over 1 completion.
 */
function fixture() {
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  const snapshot: SnapshotData = {
    people: [
      { id: "p1", displayName: "Alice" },
      { id: "p2", displayName: "Bob" },
    ],
    assets: [
      { id: "house", kind: "house", budget: "60" },
      { id: "garden", kind: "garden", budget: "25" },
    ],
    chores: [
      {
        id: "c1",
        title: "Vacuum",
        assetId: "house",
        weightTime: "2",
        weightEffort: "2",
        weightPriority: "2",
        recurrenceUnit: "week",
        recurrenceN: "1",
        nextDueAt: iso(-7),
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
      {
        id: "c2",
        title: "Mow the lawn",
        assetId: "garden",
        weightTime: "3",
        weightEffort: "3",
        weightPriority: "3",
        recurrenceUnit: "week",
        recurrenceN: "2",
        nextDueAt: iso(-7),
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
    ],
    instances: [],
    completions: [
      { mutationId: "m1", instanceId: "i1", choreId: "c1", personId: "p1", completedAt: iso(5), pointsAwarded: "10", choreTitle: "Vacuum", assetId: "house" },
      { mutationId: "m2", instanceId: "i2", choreId: "c1", personId: "p1", completedAt: iso(40), pointsAwarded: "10", choreTitle: "Vacuum", assetId: "house" },
      { mutationId: "m3", instanceId: "i3", choreId: "c2", personId: "p2", completedAt: iso(3), pointsAwarded: "20", choreTitle: "Mow the lawn", assetId: "garden" },
    ],
  };

  const windowPoints = 10 + 20;
  const p1Share = Math.round((10 / windowPoints) * 100);
  const p2Share = Math.round((20 / windowPoints) * 100);

  return { snapshot, windowPoints, p1Share, p2Share };
}

test("per-person and per-asset totals", async ({ page }) => {
  const { snapshot, windowPoints, p1Share, p2Share } = fixture();
  await installFakeServer(page, { snapshot });
  await seedCredentials(page, "p1");
  await page.goto("/");
  await page.getByTestId("nav-stats").click();

  await expect(page.getByTestId("stats-window-points")).toHaveText(String(windowPoints));

  const p1 = page.locator('[data-testid="stats-person"][data-person-id="p1"]');
  const p2 = page.locator('[data-testid="stats-person"][data-person-id="p2"]');

  await expect(p1.getByTestId("stats-person-points")).toHaveText("10");
  await expect(p1.getByTestId("stats-person-share")).toHaveText(new RegExp(String(p1Share)));
  await expect(p1).toHaveAttribute("data-tier", "0");

  await expect(p2.getByTestId("stats-person-points")).toHaveText("20");
  await expect(p2.getByTestId("stats-person-share")).toHaveText(new RegExp(String(p2Share)));
  await expect(p2).toHaveAttribute("data-tier", "0.2");

  const house = page.locator('[data-testid="stats-asset"][data-asset-id="house"]');
  const garden = page.locator('[data-testid="stats-asset"][data-asset-id="garden"]');

  // All-time totals include the 40-day-old completion, which the windowed numbers above
  // deliberately excluded.
  await expect(house.getByTestId("stats-asset-points")).toHaveText("20");
  await expect(house.getByTestId("stats-asset-completions")).toHaveText("2");

  await expect(garden.getByTestId("stats-asset-points")).toHaveText("20");
  await expect(garden.getByTestId("stats-asset-completions")).toHaveText("1");

  await expect(page.getByTestId("stats-recent-row")).toHaveCount(3);
});
