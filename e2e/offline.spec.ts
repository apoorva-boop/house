import { test, expect } from "@playwright/test";
import { installFakeServer, seedCredentials, type SnapshotData } from "./support/fakeServer";

const DAY_MS = 86_400_000;

function fixture(choreId: string, title: string): SnapshotData {
  const dueAt = new Date(Date.now() - 5 * DAY_MS).toISOString();
  return {
    people: [{ id: "p1", displayName: "Alice" }],
    assets: [{ id: "house", kind: "house", budget: "60" }],
    chores: [
      {
        id: choreId,
        title,
        assetId: "house",
        weightTime: "3",
        weightEffort: "3",
        weightPriority: "3",
        recurrenceUnit: "week",
        recurrenceN: "1",
        nextDueAt: dueAt,
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
    ],
    instances: [
      {
        instanceId: `${choreId}-inst`,
        choreId,
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

test("tick survives reload offline", async ({ page }) => {
  // The initial load must succeed -- the outage starts only once the household is on
  // screen, otherwise there would be nothing to tick.
  const server = await installFakeServer(page, { snapshot: fixture("c1", "Clean the gutters") });
  await seedCredentials(page, "p1");
  await page.goto("/");

  const row = page.locator('[data-testid="chore-row"][data-chore-id="c1"]');
  await expect(row).toHaveAttribute("data-state", "overdue");

  server.offline = true;
  await row.getByTestId("chore-tick").click();

  // The optimistic completion renders even though the transport is down, and the
  // attempt to sync it fails visibly.
  await expect(row).toHaveAttribute("data-pending", "true");
  // c1 recurs weekly, so the optimistic completion advances it a week the same way the
  // server's settleChoreAfterCompletion_ will: scheduled, and no longer reading overdue.
  await expect(row).toHaveAttribute("data-state", "scheduled");
  await expect(row.getByTestId("chore-due")).not.toContainText("overdue");
  await expect(page.getByTestId("queue-badge")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("sync-error")).toBeVisible();

  // Nothing reached the fake server while offline: the abort happens at the transport
  // layer before a request is ever recorded.
  expect(server.recorded).toHaveLength(0);

  await page.reload();

  const rowAfterReload = page.locator('[data-testid="chore-row"][data-chore-id="c1"]');
  await expect(rowAfterReload).toHaveAttribute("data-pending", "true");
  await expect(rowAfterReload).toHaveAttribute("data-state", "scheduled");
  await expect(page.getByTestId("sync-error")).toBeVisible();
  expect(server.recorded).toHaveLength(0);

  // Bring the server back and let the queue flush.
  server.offline = false;
  await page.getByTestId("sync-retry").click();

  await expect.poll(() => server.recorded.some((r) => r.op === "complete")).toBe(true);
  await expect(rowAfterReload).toHaveAttribute("data-pending", "false");
  await expect(page.getByTestId("sync-error")).toHaveCount(0);
  await expect(page.getByTestId("queue-badge")).toHaveCount(0);
});

test("drop falls into queue", async ({ page }) => {
  const server = await installFakeServer(page, { snapshot: fixture("c2", "Check the smoke alarms") });
  await seedCredentials(page, "p1");
  await page.goto("/");

  const row = page.locator('[data-testid="chore-row"][data-chore-id="c2"]');
  await expect(row).toHaveAttribute("data-state", "overdue");

  server.offline = true;
  await row.getByTestId("chore-tick").click();

  await expect(page.getByTestId("queue-badge")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("sync-error")).toBeVisible();
  expect(server.recorded.some((r) => r.op === "complete")).toBe(false);

  server.offline = false;
  await page.getByTestId("sync-retry").click();

  await expect.poll(() => server.recorded.some((r) => r.op === "complete")).toBe(true);
  await expect(page.getByTestId("queue-badge")).toHaveCount(0);
  await expect(page.getByTestId("sync-error")).toHaveCount(0);
});
