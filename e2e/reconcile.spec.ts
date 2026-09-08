import { test, expect } from "@playwright/test";
import { installFakeServer, seedCredentials, type SnapshotData, type Recorded } from "./support/fakeServer";

const DAY_MS = 86_400_000;

/**
 * Two chores:
 * - c1 has an open, overdue instance. It will be ticked, and the fake server is wired
 *   to reject `complete` forever, so it never leaves the queue.
 * - c2 has no open instance and a completion already sitting in the snapshot -- a
 *   settled, server-confirmed state with nothing in the queue about it at all.
 */
function fixture(): SnapshotData {
  const dueAt = new Date(Date.now() - 10 * DAY_MS).toISOString();
  return {
    people: [{ id: "p1", displayName: "Alice" }],
    assets: [{ id: "house", kind: "house", budget: "60" }],
    chores: [
      {
        id: "c1",
        title: "Descale the kettle",
        assetId: "house",
        weightTime: "2",
        weightEffort: "2",
        weightPriority: "2",
        recurrenceUnit: "month",
        recurrenceN: "1",
        nextDueAt: dueAt,
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
      {
        id: "c2",
        title: "Change the air filter",
        assetId: "house",
        weightTime: "2",
        weightEffort: "2",
        weightPriority: "2",
        recurrenceUnit: "month",
        recurrenceN: "3",
        nextDueAt: new Date(Date.now() + 60 * DAY_MS).toISOString(),
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
    completions: [
      {
        mutationId: "server-mut-1",
        instanceId: "i2",
        choreId: "c2",
        personId: "p1",
        completedAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
        pointsAwarded: "6",
        choreTitle: "Change the air filter",
        assetId: "house",
      },
    ],
  };
}

test("snapshot skips in-flight mutationIds", async ({ page }) => {
  const server = await installFakeServer(page, {
    snapshot: fixture(),
    handler: (r: Recorded) => (r.op === "complete" ? { status: 500, body: {} } : null),
  });
  await seedCredentials(page, "p1");
  await page.goto("/");
  // The map is now the launch screen (contract section 7); reach the chore list from it.
  await page.getByTestId("nav-chores").click();

  // Mirror case, up front: c2's completion comes purely from the base snapshot -- no
  // queue involvement -- and renders as settled.
  const rowC2 = page.locator('[data-testid="chore-row"][data-chore-id="c2"]');
  await expect(rowC2).toHaveAttribute("data-state", "scheduled");
  await expect(rowC2).toHaveAttribute("data-pending", "false");

  // Tick c1. It can never reach the server (handler always rejects "complete"), so it
  // stays in the queue indefinitely.
  const rowC1 = page.locator('[data-testid="chore-row"][data-chore-id="c1"]');
  await expect(rowC1).toHaveAttribute("data-state", "overdue");
  await rowC1.getByTestId("chore-tick").click();
  await expect(rowC1).toHaveAttribute("data-pending", "true");
  await expect(page.getByTestId("queue-badge")).toHaveAttribute("data-count", "1");

  // THE PRIMARY PROOF. An in-app refresh fetches a fresh snapshot into a live app whose
  // queue is not empty -- "a snapshot lands mid-flight". The snapshot still does not
  // contain c1's completion, so only the queue overlay can be keeping it on screen.
  await page.getByTestId("refresh").click();

  // c1 recurs monthly, so the optimistic completion advanced it a month: still pending,
  // and scheduled rather than overdue.
  await expect(rowC1).toHaveAttribute("data-pending", "true");
  await expect(rowC1).toHaveAttribute("data-state", "scheduled");

  // The mirror case still holds across that same merge: c2, sourced only from the base
  // snapshot with nothing in the queue about it, is untouched by the overlay.
  await expect(rowC2).toHaveAttribute("data-pending", "false");
  await expect(rowC2).toHaveAttribute("data-state", "scheduled");

  // A weaker second check: the same merge after a full reboot, which additionally reads
  // the queue back out of IndexedDB. Weaker because it also proves persistence, which is
  // flow 7's job -- the click above is what proves the merge.
  await page.reload();
  // A reload re-boots the app, which lands on the map again (contract section 7).
  await page.getByTestId("nav-chores").click();

  const rowC1After = page.locator('[data-testid="chore-row"][data-chore-id="c1"]');
  await expect(rowC1After).toHaveAttribute("data-pending", "true");
  await expect(rowC1After).toHaveAttribute("data-state", "scheduled");

  const rowC2After = page.locator('[data-testid="chore-row"][data-chore-id="c2"]');
  await expect(rowC2After).toHaveAttribute("data-pending", "false");
  await expect(rowC2After).toHaveAttribute("data-state", "scheduled");

  expect(server.recorded.some((r) => r.op === "complete")).toBe(true);
});
