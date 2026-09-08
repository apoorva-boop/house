import { test, expect } from "@playwright/test";
import { installFakeServer, seedCredentials, type SnapshotData, type Recorded } from "./support/fakeServer";

const DAY_MS = 86_400_000;

// points = clamp(round(2*3 + 2*3 + 3*3), 5, 35) = clamp(round(21), 5, 35) = 21.
const EXPECTED_POINTS = "21";

function fixture(): SnapshotData {
  const dueAt = new Date(Date.now() - 10 * DAY_MS).toISOString();
  return {
    people: [
      { id: "p1", displayName: "Alice" },
      { id: "p2", displayName: "Bob" },
    ],
    assets: [{ id: "house", kind: "house", budget: "60" }],
    chores: [
      {
        id: "c1",
        title: "Scrub the tub",
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

test("no phantom completion on 500", async ({ page }) => {
  const snapshot = fixture();
  let shouldFail = true;

  const server = await installFakeServer(page, {
    snapshot,
    handler: (r: Recorded) => {
      if (r.op !== "complete") return null;
      if (shouldFail) {
        return { status: 500, body: {} };
      }
      const row = {
        mutationId: r.mutationId,
        instanceId: String(r.payload?.instanceId ?? ""),
        personId: "p1",
        choreId: String(r.payload?.choreId ?? "c1"),
        completedAt: String(r.payload?.completedAt ?? new Date().toISOString()),
        pointsAwarded: EXPECTED_POINTS,
        choreTitle: "Scrub the tub",
        assetId: "house",
      };
      snapshot.completions.push(row);
      return { body: { ok: true, data: { completion: row }, serverTime: new Date().toISOString(), version: 1 } };
    },
  });

  await seedCredentials(page, "p1");
  await page.goto("/");
  await page.getByTestId("nav-stats").click();

  const windowPoints = page.getByTestId("stats-window-points");
  const p1Points = page.locator('[data-testid="stats-person"][data-person-id="p1"]').getByTestId("stats-person-points");
  const housePoints = page.locator('[data-testid="stats-asset"][data-asset-id="house"]').getByTestId("stats-asset-points");
  const houseCompletions = page.locator('[data-testid="stats-asset"][data-asset-id="house"]').getByTestId("stats-asset-completions");

  const baselineWindow = await windowPoints.textContent();
  const baselineP1 = await p1Points.textContent();
  const baselineHousePoints = await housePoints.textContent();
  const baselineHouseCompletions = await houseCompletions.textContent();
  const baselineRecentCount = await page.getByTestId("stats-recent-row").count();

  await page.getByTestId("nav-chores").click();
  const row = page.locator('[data-testid="chore-row"][data-chore-id="c1"]');
  await expect(row).toHaveAttribute("data-state", "overdue");
  await row.getByTestId("chore-tick").click();

  // The optimistic UI still moves (that's the "never awaits the network" rule), but the
  // sync visibly fails.
  await expect(page.getByTestId("sync-error")).toBeVisible();
  await expect(row).toHaveAttribute("data-pending", "true");

  // No completion is recorded: the stats screen matches its pre-tick baseline exactly.
  await page.getByTestId("nav-stats").click();
  await expect(windowPoints).toHaveText(baselineWindow ?? "");
  await expect(p1Points).toHaveText(baselineP1 ?? "");
  await expect(housePoints).toHaveText(baselineHousePoints ?? "");
  await expect(houseCompletions).toHaveText(baselineHouseCompletions ?? "");
  expect(await page.getByTestId("stats-recent-row").count()).toBe(baselineRecentCount);

  // Not after a reload, either.
  await page.reload();
  await page.getByTestId("nav-stats").click();
  await expect(windowPoints).toHaveText(baselineWindow ?? "");
  await expect(p1Points).toHaveText(baselineP1 ?? "");
  await expect(housePoints).toHaveText(baselineHousePoints ?? "");
  await expect(houseCompletions).toHaveText(baselineHouseCompletions ?? "");
  expect(await page.getByTestId("stats-recent-row").count()).toBe(baselineRecentCount);

  // The false-positive guard: the same tick, against a server that now returns 200,
  // DOES get recorded. Without this half, the assertions above would also pass against
  // an app that silently drops every completion.
  shouldFail = false;
  await page.getByTestId("sync-retry").click();
  // Poll for the completion the server actually WROTE, not for a count of attempts.
  // Defect #8, in the testing sub-plan's register: the reload above re-flushes the
  // queue against the still-500 server, so a count of `complete` requests reaches 2 on
  // two FAILED attempts before this retry is even clicked -- and the reload below then
  // aborts the retry in flight, so nothing is ever recorded. Waiting on the write is
  // the thing this half of the test was always about.
  await expect.poll(() => snapshot.completions.length).toBe(1);

  // The retry re-sends the SAME mutationId. "Minted at enqueue, never at POST" is a
  // stated non-negotiable of this project -- a retry that minted a fresh id would write
  // a second Completions row on the real server, because the server dedupes on this.
  const attempts = server.recorded.filter((r) => r.op === "complete");
  expect(attempts[0]?.mutationId).toBeTruthy();
  expect(attempts[1]?.mutationId).toBe(attempts[0]?.mutationId);

  await page.reload();
  await page.getByTestId("nav-stats").click();
  await expect(page.getByTestId("stats-window-points")).toHaveText(EXPECTED_POINTS);
  await expect(
    page.locator('[data-testid="stats-person"][data-person-id="p1"]').getByTestId("stats-person-points")
  ).toHaveText(EXPECTED_POINTS);
  await expect(
    page.locator('[data-testid="stats-asset"][data-asset-id="house"]').getByTestId("stats-asset-points")
  ).toHaveText(EXPECTED_POINTS);
  await expect(
    page.locator('[data-testid="stats-asset"][data-asset-id="house"]').getByTestId("stats-asset-completions")
  ).toHaveText("1");
  await expect(page.getByTestId("stats-recent-row")).toHaveCount(baselineRecentCount + 1);
});
