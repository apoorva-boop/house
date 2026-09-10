import { test, expect } from "@playwright/test";
import { installFakeServer, seedCredentials, type SnapshotData } from "./support/fakeServer";

/**
 * Flow 51's client half: dates are read in the HOUSEHOLD's zone, not the phone's.
 *
 * The browser here is pinned to UTC and the chore is due at a fixed instant late in a
 * UTC day — 15 June 2030, 22:00 UTC. That same instant is already 16 June in
 * Pacific/Kiritimati, which is UTC+14. So the calendar date the app prints is a direct
 * readout of which zone it did the arithmetic in, with no dependence on when the suite
 * happens to run.
 *
 * The two tests are the two halves of the rule. With a `timeZone` on the snapshot the
 * app must use it; without one it must fall back to the browser's, which is what an
 * Apps Script deployment older than this field still sends and what every other spec in
 * this suite assumes.
 */
test.use({ timezoneId: "UTC" });

/** 22:00 UTC on 15 June 2030. 16 June, 12:00, in Pacific/Kiritimati. */
const DUE_AT = "2030-06-15T22:00:00.000Z";

function fixture(): SnapshotData {
  return {
    people: [{ id: "p1", displayName: "Alice" }],
    assets: [{ id: "house", kind: "house", budget: "60" }],
    chores: [
      {
        id: "c1",
        title: "Vacuum the lounge",
        assetId: "house",
        weightTime: "2",
        weightEffort: "2",
        weightPriority: "2",
        recurrenceUnit: "week",
        recurrenceN: "1",
        nextDueAt: DUE_AT,
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
    ],
    instances: [],
    completions: [],
  };
}

test("due dates are read in the household's zone", async ({ page }) => {
  await installFakeServer(page, { snapshot: fixture(), timeZone: "Pacific/Kiritimati" });
  await seedCredentials(page);
  await page.goto("/");
  // The map is now the launch screen (contract section 7); reach the chore list from it.
  await page.getByTestId("nav-chores").click();

  const row = page.locator('[data-testid="chore-row"][data-chore-id="c1"]');
  await expect(row.getByTestId("chore-due")).toHaveText("due 16 Jun");
});

test("falls back to the browser's zone when the snapshot carries none", async ({ page }) => {
  // `timeZone` defaults to "" on the fake server, which is what a deployment predating
  // the field sends. The browser is UTC, so the same instant reads as the 15th.
  await installFakeServer(page, { snapshot: fixture() });
  await seedCredentials(page);
  await page.goto("/");
  // The map is now the launch screen (contract section 7); reach the chore list from it.
  await page.getByTestId("nav-chores").click();

  const row = page.locator('[data-testid="chore-row"][data-chore-id="c1"]');
  await expect(row.getByTestId("chore-due")).toHaveText("due 15 Jun");
});
