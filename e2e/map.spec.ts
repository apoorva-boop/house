import { test, expect } from "@playwright/test";
import { installFakeServer, seedCredentials, settlesCompletion, type SnapshotData } from "./support/fakeServer";
import { pan, pinch } from "./support/gestures";

// The primary target size from the map contract (section 1's test list). hasTouch is
// file-wide because most tests here drive the map with a mouse-driven pan (which the
// browser reports as pointerType "mouse" regardless of hasTouch) and only the pinch
// test needs real touch input -- enabling it everywhere is harmless.
test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

const DAY_MS = 86_400_000;

function baseAssets(): SnapshotData {
  return {
    people: [
      { id: "p1", displayName: "Alice" },
      { id: "p2", displayName: "Bob" },
    ],
    assets: [
      { id: "house", kind: "house", budget: "60" },
      { id: "garden", kind: "garden", budget: "25" },
      { id: "car", kind: "car", budget: "30" },
    ],
    chores: [],
    instances: [],
    completions: [],
  };
}

/** Parses `translate(TX,TY) scale(S)`, the exact form the contract (section 2) fixes. */
function parseCameraTransform(transform: string): { tx: number; ty: number; scale: number } {
  const m = transform.match(/translate\(([-\d.]+),\s*([-\d.]+)\)\s*scale\(([-\d.]+)\)/);
  if (!m) throw new Error(`unparseable camera transform: "${transform}"`);
  return { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) };
}

test("house, garden and car at default zoom on 375x667", async ({ page }) => {
  await installFakeServer(page, { snapshot: baseAssets() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  await expect(page.locator('[data-testid="map-asset"]')).toHaveCount(3);

  for (const id of ["house", "garden", "car"] as const) {
    const el = page.locator(`[data-testid="map-asset"][data-asset-id="${id}"]`);
    await expect(el).toHaveCount(1);
    const box = await el.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    // Wholly inside the 375x667 viewport at the default camera.
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(box!.y + box!.height).toBeLessThanOrEqual(667);
  }
});

test("drag pans", async ({ page }) => {
  await installFakeServer(page, { snapshot: baseAssets() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  const svg = page.getByTestId("map-svg");
  const camera = page.getByTestId("camera");

  const svgBox = await svg.boundingBox();
  expect(svgBox).not.toBeNull();
  const center = { x: svgBox!.x + svgBox!.width / 2, y: svgBox!.y + svgBox!.height / 2 };

  const before = parseCameraTransform((await camera.getAttribute("transform"))!);

  // A modest drag, well inside any plausible scene: the pan should not be clamped, so
  // the translation moves by exactly the drag delta. The camera transform is in screen
  // pixels (contract section 5's coordinate convention: screenX = sceneX*scale + tx),
  // so a DX,DY drag adds DX,DY to tx,ty directly, independent of the current scale.
  const DX = 40;
  const DY = 25;
  await pan(page, { from: center, to: { x: center.x + DX, y: center.y + DY } });
  const afterModest = parseCameraTransform((await camera.getAttribute("transform"))!);

  expect(afterModest.scale).toBe(before.scale);
  expect(afterModest.tx).toBeCloseTo(before.tx + DX, 0);
  expect(afterModest.ty).toBeCloseTo(before.ty + DY, 0);

  // Now drag far past the edge: the clamp must hold. Camera.ts's clamp() keeps `bounds`
  // covering `viewport`, so the camera group's own rendered bounding box (the
  // transformed scene content) must never pull back inside the svg's box on any edge --
  // both halves are needed in one test, since a clamp assertion alone would also pass
  // against a map that ignores drags entirely (it would never move off the default,
  // in-bounds position either).
  await pan(page, { from: center, to: { x: center.x - 5000, y: center.y - 5000 } });

  const svgBoxAfter = await svg.boundingBox();
  const cameraBoxAfter = await camera.boundingBox();
  expect(svgBoxAfter).not.toBeNull();
  expect(cameraBoxAfter).not.toBeNull();

  expect(cameraBoxAfter!.x).toBeLessThanOrEqual(svgBoxAfter!.x + 0.5);
  expect(cameraBoxAfter!.y).toBeLessThanOrEqual(svgBoxAfter!.y + 0.5);
  expect(cameraBoxAfter!.x + cameraBoxAfter!.width).toBeGreaterThanOrEqual(svgBoxAfter!.x + svgBoxAfter!.width - 0.5);
  expect(cameraBoxAfter!.y + cameraBoxAfter!.height).toBeGreaterThanOrEqual(svgBoxAfter!.y + svgBoxAfter!.height - 0.5);
});

test("pinch clamps", async ({ page }) => {
  await installFakeServer(page, { snapshot: baseAssets() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  const svg = page.getByTestId("map-svg");
  const camera = page.getByTestId("camera");
  const svgBox = await svg.boundingBox();
  expect(svgBox).not.toBeNull();
  const center = { x: svgBox!.x + svgBox!.width / 2, y: svgBox!.y + svgBox!.height / 2 };

  // Out to the stop. MAX_SCALE = 3 (Camera.ts, frozen by its own unit tests).
  await pinch(page, { center, startDistance: 60, endDistance: 900 });
  await expect(camera).toHaveAttribute("data-scale", "3");

  // In to the stop. MIN_SCALE = 1.
  await pinch(page, { center, startDistance: 900, endDistance: 20 });
  await expect(camera).toHaveAttribute("data-scale", "1");

  // A moderate pinch from the floor lands strictly between the two stops. The
  // false-positive guard: without this, a camera that snaps straight to MIN or MAX on
  // any pinch at all (never actually reading the gesture's distance) would also satisfy
  // the two assertions above -- "clamped" is distinguished from "stuck" only here.
  await pinch(page, { center, startDistance: 100, endDistance: 180 });
  const scale = Number(await camera.getAttribute("data-scale"));
  expect(scale).toBeGreaterThan(1);
  expect(scale).toBeLessThan(3);
});

/**
 * House has one overdue chore (c1) and one scheduled chore (c2). Garden has one
 * overdue chore (c3). "Overdue"/"scheduled" here is the row's calendar-day state
 * (ChoreListPresenter's computeRowState), which AssetPanelPresenter filters on
 * (contract section 6): c1 is due 3 days ago (overdue), c2 five days from now
 * (scheduled), c3 two days ago (overdue, but on the other asset).
 */
function houseAndGardenChoresFixture(): SnapshotData {
  const overdueHouse = new Date(Date.now() - 3 * DAY_MS).toISOString();
  const scheduledHouse = new Date(Date.now() + 5 * DAY_MS).toISOString();
  const overdueGarden = new Date(Date.now() - 2 * DAY_MS).toISOString();
  return {
    people: [
      { id: "p1", displayName: "Alice" },
      { id: "p2", displayName: "Bob" },
    ],
    assets: [
      { id: "house", kind: "house", budget: "60" },
      { id: "garden", kind: "garden", budget: "25" },
      { id: "car", kind: "car", budget: "30" },
    ],
    chores: [
      {
        id: "c1",
        title: "Vacuum the hall",
        assetId: "house",
        weightTime: "2",
        weightEffort: "2",
        weightPriority: "2",
        recurrenceUnit: "week",
        recurrenceN: "1",
        nextDueAt: overdueHouse,
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
      {
        id: "c2",
        title: "Replace the air filter",
        assetId: "house",
        weightTime: "2",
        weightEffort: "2",
        weightPriority: "2",
        recurrenceUnit: "month",
        recurrenceN: "3",
        nextDueAt: scheduledHouse,
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
      {
        id: "c3",
        title: "Mow the lawn",
        assetId: "garden",
        weightTime: "3",
        weightEffort: "3",
        weightPriority: "3",
        recurrenceUnit: "week",
        recurrenceN: "2",
        nextDueAt: overdueGarden,
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
    ],
    instances: [
      {
        instanceId: "i1",
        choreId: "c1",
        dueAt: overdueHouse,
        calendarEventId: "",
        lastNotifiedAt: "",
        snoozedUntil: "",
        scheduleState: "scheduled",
      },
      {
        instanceId: "i2",
        choreId: "c2",
        dueAt: scheduledHouse,
        calendarEventId: "",
        lastNotifiedAt: "",
        snoozedUntil: "",
        scheduleState: "scheduled",
      },
      {
        instanceId: "i3",
        choreId: "c3",
        dueAt: overdueGarden,
        calendarEventId: "",
        lastNotifiedAt: "",
        snoozedUntil: "",
        scheduleState: "scheduled",
      },
    ],
    completions: [],
  };
}

test("house panel lists only its overdue chores", async ({ page }) => {
  await installFakeServer(page, { snapshot: houseAndGardenChoresFixture() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  await page.locator('[data-testid="map-asset"][data-asset-id="house"]').click();

  const panel = page.locator('[data-testid="asset-panel"][data-asset-id="house"]');
  await expect(panel).toBeVisible();

  // The presence half: the house's own overdue chore is listed.
  await expect(panel.locator('[data-testid="panel-chore-row"][data-chore-id="c1"]')).toBeVisible();

  // The absence half, paired with the presence above: the house's scheduled chore and
  // the garden's overdue chore are both excluded.
  await expect(panel.locator('[data-testid="panel-chore-row"][data-chore-id="c2"]')).toHaveCount(0);
  await expect(panel.locator('[data-testid="panel-chore-row"][data-chore-id="c3"]')).toHaveCount(0);

  // And nothing else snuck in either.
  await expect(panel.locator('[data-testid="panel-chore-row"]')).toHaveCount(1);
});

/**
 * House, budget 60. Two overdue chores, neither recurring (capDays falls back to the
 * 14-day floor), both 30 days overdue -- so severity is saturated at 1 for each and
 * burden == weight (health.ts).
 *
 * c1: weight = clamp(round(2*3 + 2*3 + 3*3), 5, 35) = clamp(round(21), 5, 35) = 21.
 * c2: weight = clamp(round(2*2 + 2*2 + 3*2), 5, 35) = clamp(round(14), 5, 35) = 14.
 *
 * Before ticking c1, both are overdue: total burden = 21 + 14 = 35.
 *   health = max(0, round(100 - 100*35/60)) = round(41.666...) = 42 -> band "grubby"
 *   (40 <= 42 < 60).
 *
 * Ticking c1 (no recurrence) deletes its instance outright (apps/web/src/offline/
 * reconcile.ts's applyComplete mirrors settleChoreAfterCompletion_), so it drops out of
 * the overdue list entirely. Only c2 remains: total burden = 14.
 *   health = max(0, round(100 - 100*14/60)) = round(76.666...) = 77 -> band "dusty"
 *   (60 <= 77 < 80).
 *
 * 42 -> 77 crosses the real 60 boundary between "grubby" and "dusty" (health.ts's
 * healthBand).
 */
function tickBoundaryFixture(): SnapshotData {
  const dueAt = new Date(Date.now() - 30 * DAY_MS).toISOString();
  return {
    people: [{ id: "p1", displayName: "Alice" }],
    assets: [{ id: "house", kind: "house", budget: "60" }],
    chores: [
      {
        id: "c1",
        title: "Scrub the tub",
        assetId: "house",
        weightTime: "3",
        weightEffort: "3",
        weightPriority: "3",
        recurrenceUnit: "",
        recurrenceN: "0",
        nextDueAt: dueAt,
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
      {
        id: "c2",
        title: "Wipe the skirting boards",
        assetId: "house",
        weightTime: "2",
        weightEffort: "2",
        weightPriority: "2",
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
      {
        instanceId: "i2",
        choreId: "c2",
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

test("tick updates overlay, panel stays open", async ({ page }) => {
  // The band and health below are asserted on the SETTLED result, so the server has to
  // keep the write. c1 has no recurrence, so completing it leaves the chore with no next
  // date at all. Defect 15 in the testing sub-plan's register.
  const snapshot = tickBoundaryFixture();
  await installFakeServer(page, {
    snapshot,
    handler: settlesCompletion(snapshot, { nextDueAt: "", pointsAwarded: "21" }),
  });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  const houseAsset = page.locator('[data-testid="map-asset"][data-asset-id="house"]');
  await expect(houseAsset).toHaveAttribute("data-band", "grubby");

  await houseAsset.click();
  const panel = page.locator('[data-testid="asset-panel"][data-asset-id="house"]');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-band", "grubby");
  await expect(panel.getByTestId("panel-health")).toHaveText("42");

  const row = panel.locator('[data-testid="panel-chore-row"][data-chore-id="c1"]');
  await expect(row).toBeVisible();
  await row.getByTestId("panel-chore-tick").click();

  // The panel stays open, on the same asset, and both the health readout and the band
  // move across the 60 boundary worked out in the fixture's comment.
  await expect(panel).toHaveAttribute("data-asset-id", "house");
  await expect(panel).toHaveAttribute("data-band", "dusty");
  await expect(panel.getByTestId("panel-health")).toHaveText("77");

  // The overlay on the map itself updates too, not just the panel.
  await expect(houseAsset).toHaveAttribute("data-band", "dusty");
});

/**
 * Fairness window arithmetic (packages/domain/src/rules/fairness.ts), all three
 * completions well inside the 30-day window:
 *
 * p1 earns 10 points (one completion). p2 earns 15 + 15 = 30 points (two completions).
 * windowPoints = 10 + 30 = 40.
 * p2 share = 30 / 40 = 0.75 -> 75%.
 * confidence = min(1, windowPoints / 20) = min(1, 2) = 1.
 * p2 overload = max(0, share/0.5 - 1) = max(0, 1.5 - 1) = 0.5.
 * effectiveOverload = overload * confidence = 0.5 * 1 = 0.5.
 * tierFor(0.5): TIERS = [0, 0.2, 0.4, 0.6, 0.8]; 0.5 clears 0, 0.2 and 0.4 but not 0.6,
 * so tier = 0.4.
 */
function personPanelFixture(): SnapshotData {
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
        title: "Vacuum",
        assetId: "house",
        weightTime: "2",
        weightEffort: "2",
        weightPriority: "2",
        recurrenceUnit: "week",
        recurrenceN: "1",
        nextDueAt: "",
        deadlineDate: "",
        leadTimeDays: "",
        deletedAt: "",
      },
    ],
    instances: [],
    completions: [
      {
        mutationId: "m1",
        instanceId: "i1",
        choreId: "c1",
        personId: "p1",
        completedAt: iso(5),
        pointsAwarded: "10",
        choreTitle: "Vacuum",
        assetId: "house",
      },
      {
        mutationId: "m2",
        instanceId: "i2",
        choreId: "c1",
        personId: "p2",
        completedAt: iso(4),
        pointsAwarded: "15",
        choreTitle: "Vacuum",
        assetId: "house",
      },
      {
        mutationId: "m3",
        instanceId: "i3",
        choreId: "c1",
        personId: "p2",
        completedAt: iso(3),
        pointsAwarded: "15",
        choreTitle: "Vacuum",
        assetId: "house",
      },
    ],
  };
}

test("person panel shows tier, points, share", async ({ page }) => {
  await installFakeServer(page, { snapshot: personPanelFixture() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  await page.locator('[data-testid="map-character"][data-person-id="p2"]').click();

  const panel = page.locator('[data-testid="person-panel"][data-person-id="p2"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("person-panel-name")).toHaveText("Bob");
  await expect(panel.getByTestId("person-panel-tier")).toHaveAttribute("data-tier", "0.4");
  await expect(panel.getByTestId("person-panel-points")).toHaveText("30");
  await expect(panel.getByTestId("person-panel-share")).toHaveText("75%");
});

test("character positions invariant under pan", async ({ page }) => {
  await installFakeServer(page, { snapshot: baseAssets() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  const svg = page.getByTestId("map-svg");
  const camera = page.getByTestId("camera");
  const char1 = page.locator('[data-testid="map-character"][data-person-id="p1"]');
  const char2 = page.locator('[data-testid="map-character"][data-person-id="p2"]');

  const svgBox = await svg.boundingBox();
  expect(svgBox).not.toBeNull();
  const center = { x: svgBox!.x + svgBox!.width / 2, y: svgBox!.y + svgBox!.height / 2 };

  const transformBefore = await camera.getAttribute("transform");
  const box1Before = await char1.boundingBox();
  const box2Before = await char2.boundingBox();
  expect(box1Before).not.toBeNull();
  expect(box2Before).not.toBeNull();

  await pan(page, { from: center, to: { x: center.x + 60, y: center.y + 40 } });

  const transformAfter = await camera.getAttribute("transform");
  // The "did change" half: without it, this test would also pass against a map that
  // cannot pan at all, since both boxes would then trivially be unchanged.
  expect(transformAfter).not.toBe(transformBefore);

  // The characters are siblings of the svg, not descendants of [data-testid="camera"]
  // (contract section 2), so their own screen positions must not move with the camera.
  const box1After = await char1.boundingBox();
  const box2After = await char2.boundingBox();
  expect(box1After).not.toBeNull();
  expect(box2After).not.toBeNull();
  expect(box1After).toEqual(box1Before);
  expect(box2After).toEqual(box2Before);
});

test("scrim tap closes, camera preserved, focus returns", async ({ page }) => {
  await installFakeServer(page, { snapshot: baseAssets() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  const svg = page.getByTestId("map-svg");
  const camera = page.getByTestId("camera");
  const svgBox = await svg.boundingBox();
  expect(svgBox).not.toBeNull();
  const center = { x: svgBox!.x + svgBox!.width / 2, y: svgBox!.y + svgBox!.height / 2 };

  // Move the camera off its default first, so "preserved" is a real assertion rather
  // than trivially true against a camera that never moved.
  await pan(page, { from: center, to: { x: center.x - 50, y: center.y - 30 } });
  await page.getByTestId("zoom-in").click();
  const expectedTransform = await camera.getAttribute("transform");
  expect(expectedTransform).not.toBeNull();

  const houseAsset = page.locator('[data-testid="map-asset"][data-asset-id="house"]');
  await houseAsset.focus();
  await page.keyboard.press("Enter");

  const panel = page.locator('[data-testid="asset-panel"][data-asset-id="house"]');
  await expect(panel).toBeVisible();

  await page.getByTestId("panel-scrim").click();

  await expect(page.locator('[data-testid="asset-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="panel-scrim"]')).toHaveCount(0);
  await expect(camera).toHaveAttribute("transform", expectedTransform!);
  await expect(houseAsset).toBeFocused();
});
