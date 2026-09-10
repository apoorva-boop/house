import { test, expect } from "@playwright/test";
import { installFakeServer, seedCredentials, type SnapshotData } from "./support/fakeServer";

const DAY_MS = 86_400_000;

/**
 * One chore, 30 days overdue, on an asset whose budget makes the arithmetic exact:
 * weight = clamp(round(2*5 + 2*5 + 3*5), 5, 35) = 35. capDays falls back to 14 (no
 * recurrence, no lead time), so at 30 days overdue severity is saturated at 1 and
 * burden = 35. health = max(0, round(100 - 100*35/60)) = 42.
 */
function overdueFixture(): SnapshotData {
  const dueAt = new Date(Date.now() - 30 * DAY_MS).toISOString();
  return {
    people: [{ id: "p1", displayName: "Alice" }],
    assets: [{ id: "house", kind: "house", budget: "60" }],
    chores: [
      {
        id: "c1",
        title: "Scrub the tub",
        assetId: "house",
        weightTime: "5",
        weightEffort: "5",
        weightPriority: "5",
        recurrenceUnit: "",
        recurrenceN: "0",
        nextDueAt: dueAt,
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
    ],
    instances: [
      {
        instanceId: "i1",
        choreId: "c1",
        dueAt,
        calendarEventId: "",
        lastNotifiedAt: "",
        snoozedUntil: "",
        scheduleState: "scheduled",
      },
    ],
    completions: [],
  };
}

test("picture updates under 100ms", async ({ page }) => {
  // Latency is 15x the 100ms budget: if the row/health change lands inside 100ms, it
  // physically cannot be waiting on this response.
  const server = await installFakeServer(page, { snapshot: overdueFixture(), latencyMs: 1500 });
  await seedCredentials(page, "p1");
  await page.goto("/");
  // The map is now the launch screen (contract section 7); reach the chore list from it.
  await page.getByTestId("nav-chores").click();

  const health = page.locator('[data-testid="asset-health"][data-asset-id="house"]');
  const row = page.locator('[data-testid="chore-row"][data-chore-id="c1"]');

  await expect(health).toHaveText("42");
  await expect(row).toHaveAttribute("data-state", "overdue");
  await expect(row).toHaveAttribute("data-pending", "false");

  // The 100ms timeout below is the whole assertion. expect() polls immediately after
  // the click, and the fake server is holding every response for 1500ms, so an app that
  // awaited the network before rendering physically cannot satisfy it. A wall-clock
  // measurement around the click was tried and removed: it spans a Playwright round trip
  // as well as the render, so it measures the harness as much as the app.
  const tickButton = row.getByTestId("chore-tick");
  await tickButton.click();
  await expect(health).toHaveText("100", { timeout: 100 });

  // The matching presence: the mutation really was sent, it just hasn't been answered
  // yet -- 1500ms of latency has not elapsed, so the row is still marked pending and no
  // response has been folded in.
  // Filtered to `complete`. The first request the app makes is always the `snapshot`
  // that gives it a household to tick -- flow 2 requires that fetch, so counting every
  // recorded request here asserted something no correct implementation could satisfy.
  expect(server.recorded.filter((r) => r.op === "complete")).toHaveLength(1);
  await expect(row).toHaveAttribute("data-pending", "true");

  // Let the delayed responses land so the test doesn't leave a dangling timer running.
  // Two sequential round trips at 1500ms each: the `complete`, and then the snapshot
  // that replaces the now-stale base household. Clearing pending after the first would
  // be worse than slower -- the queue is empty by then but the base still lacks the
  // completion, so the chore would visibly snap back to overdue.
  await expect(row).toHaveAttribute("data-pending", "false", { timeout: 6000 });
});
