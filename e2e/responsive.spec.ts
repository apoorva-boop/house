import { test, expect } from "@playwright/test";
import { installFakeServer, seedCredentials, type SnapshotData } from "./support/fakeServer";

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

/**
 * Every visible `button`, `input`, `select` and `a` on the page right now, as
 * `{width, height}` (for the 44px check) or `{top, bottom}` (for the inset check) --
 * shared shape covers both call sites below.
 */
async function visibleControlBoxes(page: import("@playwright/test").Page): Promise<
  { width: number; height: number; top: number; bottom: number }[]
> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, input, select, a")) as HTMLElement[];
    return els
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, top: r.top, bottom: r.bottom };
      });
  });
}

test("panel moves to side sheet, camera preserved", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await installFakeServer(page, { snapshot: baseAssets() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  await page.locator('[data-testid="map-asset"][data-asset-id="house"]').click();
  const panel = page.locator('[data-testid="asset-panel"][data-asset-id="house"]');
  await expect(panel).toBeVisible();

  // Portrait (375x667, orientation: portrait): a bottom sheet -- full width, anchored
  // to the bottom, roughly 60% of the viewport height (contract section 4). Geometry,
  // not a data-layout attribute: an attribute would only prove a media query was read,
  // not that the layout actually moved.
  let box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(375 * 0.9);
  expect(box!.y + box!.height).toBeGreaterThan(667 - 5);
  expect(box!.height).toBeGreaterThan(667 * 0.5);
  expect(box!.height).toBeLessThan(667 * 0.7);

  const cameraTransformBefore = await page.getByTestId("camera").getAttribute("transform");
  expect(cameraTransformBefore).not.toBeNull();

  // Rotate: 667x375, orientation: landscape.
  await page.setViewportSize({ width: 667, height: 375 });

  // A right-hand side sheet -- anchored to the right edge, full height, under half the
  // viewport width (contract section 4).
  box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeGreaterThan(667 - 5);
  expect(box!.height).toBeGreaterThan(375 * 0.9);
  expect(box!.width).toBeLessThan(667 * 0.5);

  // The rotation must not have disturbed the camera.
  await expect(page.getByTestId("camera")).toHaveAttribute("transform", cameraTransformBefore!);
});

test("no control inside safe-area insets", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await installFakeServer(page, { snapshot: baseAssets() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  // Simulate a notched device: a 47px top inset (the notch) and a 34px bottom inset
  // (the home indicator) -- stand-in numbers for "a device with real insets", not any
  // particular model. Overriding the custom properties directly is what the contract's
  // safe-area section promises a test can do (section 4): production CSS may only
  // consume `env(safe-area-inset-*)` through these four :root variables.
  await page.addStyleTag({
    content: ":root { --safe-top: 47px; --safe-right: 0px; --safe-bottom: 34px; --safe-left: 0px; }",
  });

  const TOP_INSET = 47;
  const BOTTOM_INSET = 34;
  const VIEWPORT_HEIGHT = 667;

  async function assertNoControlInInsets(): Promise<void> {
    const boxes = await visibleControlBoxes(page);
    expect(boxes.length).toBeGreaterThan(0);

    // The guard: at least one control really does sit near the bottom edge (within
    // 90px), otherwise this test would pass trivially against a layout with nothing
    // near either edge at all.
    const nearBottom = boxes.some((b) => VIEWPORT_HEIGHT - b.bottom < 90);
    expect(nearBottom).toBe(true);

    for (const b of boxes) {
      expect(b.top).toBeGreaterThanOrEqual(TOP_INSET);
      expect(b.bottom).toBeLessThanOrEqual(VIEWPORT_HEIGHT - BOTTOM_INSET);
    }
  }

  await assertNoControlInInsets();

  await page.locator('[data-testid="map-asset"][data-asset-id="house"]').click();
  await expect(page.getByTestId("asset-panel")).toBeVisible();
  await assertNoControlInInsets();
});

test("375x667 targets all >= 44px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await installFakeServer(page, { snapshot: baseAssets() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  async function assertAllTargetsAtLeast44(): Promise<void> {
    const boxes = await visibleControlBoxes(page);
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
  }

  await assertAllTargetsAtLeast44();

  await page.locator('[data-testid="map-asset"][data-asset-id="house"]').click();
  await expect(page.getByTestId("asset-panel")).toBeVisible();
  await assertAllTargetsAtLeast44();
});

test("zoom buttons reach both limits with the side sheet open", async ({ page }) => {
  // Landscape from the start: 375x667 turned on its side.
  await page.setViewportSize({ width: 667, height: 375 });
  await installFakeServer(page, { snapshot: baseAssets() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  const camera = page.getByTestId("camera");
  await expect(camera).toHaveAttribute("data-scale", "1");

  await page.locator('[data-testid="map-asset"][data-asset-id="house"]').click();
  const panel = page.locator('[data-testid="asset-panel"][data-asset-id="house"]');
  await expect(panel).toBeVisible();

  // The side sheet, as "panel moves to side sheet" above defines it: anchored to the
  // right edge, full height, under half the viewport width.
  const sheet = await panel.boundingBox();
  expect(sheet).not.toBeNull();
  expect(sheet!.x + sheet!.width).toBeGreaterThan(667 - 5);
  expect(sheet!.height).toBeGreaterThan(375 * 0.9);
  expect(sheet!.width).toBeLessThan(667 * 0.5);

  // Both zoom buttons sit beside the sheet -- not under it, and not floating on top of
  // it either. Geometry before clicks: a button the sheet covers would otherwise only
  // show up as a click that times out.
  const zoomIn = page.getByTestId("zoom-in");
  const zoomOut = page.getByTestId("zoom-out");
  for (const button of [zoomIn, zoomOut]) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(sheet!.x);
  }

  // Flow 58: the whole 1x-3x range by button, with the panel open the whole time.
  for (let i = 0; i < 20; i++) await zoomIn.click();
  await expect(camera).toHaveAttribute("data-scale", "3");
  await expect(panel).toBeVisible();

  for (let i = 0; i < 20; i++) await zoomOut.click();
  await expect(camera).toHaveAttribute("data-scale", "1");
  await expect(panel).toBeVisible();
});
