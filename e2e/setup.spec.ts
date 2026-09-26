import { test, expect } from "@playwright/test";
import { installFakeServer, EXEC_URL, TOKEN, type SnapshotData } from "./support/fakeServer";

function snapshotWithTwoChores(): SnapshotData {
  return {
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
        title: "Vacuum the lounge",
        assetId: "house",
        weightTime: "2",
        weightEffort: "2",
        weightPriority: "2",
        recurrenceUnit: "week",
        recurrenceN: "1",
        nextDueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
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
        nextDueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
    ],
    instances: [],
    completions: [],
  };
}

test("renders setup not game", async ({ page }) => {
  // Nothing in localStorage: installFakeServer/seedCredentials are deliberately not
  // called for credentials here, so the app boots with no house.credentials at all.
  await installFakeServer(page, { snapshot: snapshotWithTwoChores() });
  await page.goto("/");

  await expect(page.getByTestId("setup-screen")).toBeVisible();
  await expect(page.getByTestId("setup-exec-url")).toBeVisible();
  await expect(page.getByTestId("setup-token")).toBeVisible();
  await expect(page.getByTestId("setup-submit")).toBeVisible();

  // The matching absence: no chore list and no app shell anywhere on the page.
  await expect(page.getByTestId("chore-list")).toHaveCount(0);
  await expect(page.getByTestId("app-shell")).toHaveCount(0);
});

test("stores creds and loads snapshot", async ({ page }) => {
  await installFakeServer(page, { snapshot: snapshotWithTwoChores(), me: "p1" });
  await page.goto("/");

  await expect(page.getByTestId("setup-screen")).toBeVisible();
  await page.getByTestId("setup-exec-url").fill(EXEC_URL);
  await page.getByTestId("setup-token").fill(TOKEN);
  await page.getByTestId("setup-submit").click();

  // Setup is one stage. There is no "who are you?" step and no person picker: the
  // snapshot's `me` says which People row the token belongs to, so the question the
  // picker asked was one the server had already answered.
  await expect(page.getByTestId("setup-person-option")).toHaveCount(0);

  // Credentials are the script URL and the token, and nothing else. No personId: a
  // stored copy of who you are would be a second answer to a question the token settles.
  const stored = await page.evaluate(() => window.localStorage.getItem("house.credentials"));
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored as string)).toEqual({ execUrl: EXEC_URL, token: TOKEN });

  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("setup-screen")).toHaveCount(0);
  // Finishing setup lands on the map, like every later launch (plan section 3a; #12,
  // defect 16 in the testing register). The chore list is one click away from it.
  await expect(page.getByTestId("map-screen")).toBeVisible();
  await page.getByTestId("nav-chores").click();
  await expect(page.getByTestId("chore-list")).toBeVisible();

  // The household from that snapshot is what's on screen now -- specific titles, not
  // just "something rendered".
  const titles = await page.getByTestId("chore-title").allTextContents();
  expect(titles.sort()).toEqual(["Mow the lawn", "Vacuum the lounge"]);
});
