import { test, expect, type Page } from "@playwright/test";
import { installFakeServer, seedCredentials, settlesCompletion, type SnapshotData } from "./support/fakeServer";

const DAY_MS = 86_400_000;

function fixture(): SnapshotData {
  const dueAt = new Date(Date.now() - 3 * DAY_MS).toISOString();
  return {
    people: [
      { id: "p1", displayName: "Alice" },
      { id: "p2", displayName: "Bob" },
    ],
    assets: [{ id: "house", kind: "house", budget: "60" }],
    chores: [
      {
        id: "c1",
        title: "Wipe the counters",
        assetId: "house",
        weightTime: "2",
        weightEffort: "2",
        weightPriority: "2",
        recurrenceUnit: "day",
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

/**
 * Tags every visible `button`, `input`, `select` and `a` on the current screen with a
 * throwaway index, and returns how many there are. Re-run per screen, since which
 * elements are on screen (and hence which indices apply) changes with navigation.
 */
async function tagVisibleControls(page: Page): Promise<number> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, input, select, a")) as HTMLElement[];
    const visible = els.filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });
    visible.forEach((el, i) => el.setAttribute("data-a11y-probe", String(i)));
    return visible.length;
  });
}

/** Tabs forward, recording the `data-a11y-probe` index of whatever gets focused. */
async function reachableByTab(page: Page, atLeast: number): Promise<Set<number>> {
  // Blur first so the very next Tab starts from the top of the document. Without this,
  // focus left over from a previous interaction could sit partway through this screen's
  // order and the walk would never reach the controls before it (there's no wraparound).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const reached = new Set<number>();
  const attempts = atLeast + 5;
  for (let i = 0; i < attempts; i++) {
    await page.keyboard.press("Tab");
    const idx = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const v = el?.getAttribute("data-a11y-probe");
      return v === null || v === undefined ? null : Number(v);
    });
    if (idx !== null) reached.add(idx);
  }
  return reached;
}

async function assertFullyTabbable(page: Page): Promise<void> {
  const total = await tagVisibleControls(page);
  expect(total).toBeGreaterThan(0);
  const reached = await reachableByTab(page, total);
  expect(reached.size).toBe(total);
}

test("all controls reachable without mouse", async ({ page }) => {
  // The tick below is asserted on its SETTLED result, so the server has to keep the
  // write. c1 recurs daily, so a completion leaves it due tomorrow -- "scheduled".
  // Defect 14 in the testing sub-plan's register.
  const snapshot = fixture();
  await installFakeServer(page, {
    snapshot,
    handler: settlesCompletion(snapshot, { nextDueAt: new Date(Date.now() + DAY_MS).toISOString() }),
  });
  await page.goto("/");

  // Screen 1: setup (credentials stage).
  await expect(page.getByTestId("setup-screen")).toBeVisible();
  await assertFullyTabbable(page);

  await seedCredentials(page);
  await page.reload();
  await page.getByTestId("app-shell").waitFor();
  // The map is now the launch screen (contract section 7); reach the chore list from it.
  await page.getByTestId("nav-chores").click();

  // Screen 2: chore list.
  await expect(page.getByTestId("chore-list")).toBeVisible();
  await assertFullyTabbable(page);

  // A chore can be ticked with the keyboard alone.
  const row = page.locator('[data-testid="chore-row"][data-chore-id="c1"]');
  await expect(row).toHaveAttribute("data-state", "overdue");

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    await page.keyboard.press("Tab");
    found = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el.getAttribute("data-testid") !== "chore-tick") return false;
      return el.closest('[data-chore-id="c1"]') !== null;
    });
  }
  expect(found).toBe(true);
  await page.keyboard.press("Enter");
  // c1 recurs daily, so the optimistic completion advances it a day: scheduled, not
  // unscheduled. Only a chore with no recurrence has no next date.
  await expect(row).toHaveAttribute("data-state", "scheduled");

  // Screen 3: the chore editor.
  await page.getByTestId("chore-edit").click();
  await expect(page.getByTestId("chore-editor")).toBeVisible();
  await assertFullyTabbable(page);
  await page.getByTestId("editor-cancel").click();

  // Screen 4: stats.
  await page.getByTestId("nav-stats").click();
  await expect(page.getByTestId("stats-screen")).toBeVisible();
  await assertFullyTabbable(page);
});

/** WCAG relative-luminance contrast ratio between an element's text and its own background. */
async function contrastRatioFor(page: Page, testId: string): Promise<number> {
  return page.evaluate((testId) => {
    function parseColor(c: string): [number, number, number, number] {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [255, 255, 255, 0];
      const parts = (m[1] ?? "").split(",").map((s) => parseFloat(s.trim()));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    }
    function relativeLuminance(rgb: [number, number, number]): number {
      const chan = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * (chan[0] ?? 0) + 0.7152 * (chan[1] ?? 0) + 0.0722 * (chan[2] ?? 0);
    }
    const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    if (!el) throw new Error(`no element for testid ${testId}`);
    const textColor = parseColor(getComputedStyle(el).color);

    let bgEl: HTMLElement | null = el;
    let bg = parseColor(getComputedStyle(bgEl).backgroundColor);
    while (bgEl && bg[3] === 0) {
      bgEl = bgEl.parentElement;
      if (!bgEl) break;
      bg = parseColor(getComputedStyle(bgEl).backgroundColor);
    }
    // Nothing opaque found up the tree: fall back to white, the safest assumption for a
    // page that never set an explicit background.
    if (bg[3] === 0) bg = [255, 255, 255, 1];

    const l1 = relativeLuminance([textColor[0], textColor[1], textColor[2]]) + 0.05;
    const l2 = relativeLuminance([bg[0], bg[1], bg[2]]) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }, testId);
}

test("legible in light and dark", async ({ page }) => {
  await installFakeServer(page, { snapshot: fixture() });
  await seedCredentials(page);

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    // The map is now the launch screen (contract section 7); reach the chore list from it.
    await page.getByTestId("nav-chores").click();
    await expect(page.getByTestId("chore-list")).toBeVisible();

    for (const testId of ["chore-title", "chore-due", "nav-chores"]) {
      const ratio = await contrastRatioFor(page, testId);
      expect(ratio, `${testId} in ${scheme} mode`).toBeGreaterThanOrEqual(4.5);
    }

    await page.getByTestId("nav-stats").click();
    await expect(page.getByTestId("stats-screen")).toBeVisible();
    const statsRatio = await contrastRatioFor(page, "stats-window-points");
    expect(statsRatio, `stats-window-points in ${scheme} mode`).toBeGreaterThanOrEqual(4.5);
  }
});

/** Minimal map fixture: three assets, no chores -- these two tests only exercise the
 *  zoom controls and the reduced-motion styling, not any asset panel content. */
function mapFixture(): SnapshotData {
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

test("zoom range reachable without a gesture", async ({ page }) => {
  await installFakeServer(page, { snapshot: mapFixture() });
  await seedCredentials(page);
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  const camera = page.getByTestId("camera");
  const zoomIn = page.getByTestId("zoom-in");
  const zoomOut = page.getByTestId("zoom-out");

  // Both buttons are reachable by Tab alone -- no gesture anywhere in this test.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let reachedZoomIn = false;
  let reachedZoomOut = false;
  for (let i = 0; i < 40 && !(reachedZoomIn && reachedZoomOut); i++) {
    await page.keyboard.press("Tab");
    const testId = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid") ?? null,
    );
    if (testId === "zoom-in") reachedZoomIn = true;
    if (testId === "zoom-out") reachedZoomOut = true;
  }
  expect(reachedZoomIn).toBe(true);
  expect(reachedZoomOut).toBe(true);

  const defaultScale = Number(await camera.getAttribute("data-scale"));

  await zoomIn.click();
  const afterOneIn = Number(await camera.getAttribute("data-scale"));
  // Reaches the range, not just the ends: one press moves off the default but does not
  // already land on MAX_SCALE -- otherwise "clamped at 3" below would also pass against
  // a button that snaps straight to the maximum on every press.
  expect(afterOneIn).toBeGreaterThan(defaultScale);
  expect(afterOneIn).toBeLessThan(3);

  for (let i = 0; i < 20; i++) await zoomIn.click();
  await expect(camera).toHaveAttribute("data-scale", "3");

  await zoomOut.click();
  const afterOneOut = Number(await camera.getAttribute("data-scale"));
  expect(afterOneOut).toBeLessThan(3);
  expect(afterOneOut).toBeGreaterThan(1);

  for (let i = 0; i < 20; i++) await zoomOut.click();
  await expect(camera).toHaveAttribute("data-scale", "1");
});

test("transitions instant under prefers-reduced-motion", async ({ page }) => {
  await installFakeServer(page, { snapshot: mapFixture() });
  await seedCredentials(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  const camera = page.getByTestId("camera");
  const transformBefore = await camera.getAttribute("transform");

  await page.getByTestId("zoom-in").click();
  const transformAfterReduce = await camera.getAttribute("transform");
  // The state change really happens under "reduce" too -- without this, the zero
  // durations checked below would also pass against a camera frozen at its default.
  expect(transformAfterReduce).not.toBe(transformBefore);

  const cameraDurationReduce = await camera.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(cameraDurationReduce).toBe("0s");

  await page.locator('[data-testid="map-asset"][data-asset-id="house"]').click();
  const panel = page.getByTestId("asset-panel");
  await expect(panel).toBeVisible();
  const panelDurationReduce = await panel.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(panelDurationReduce).toBe("0s");
  await page.getByTestId("panel-close").click();

  // The paired half: under "no-preference", the same two durations are non-zero, and
  // the state changes still happen the same way. Without this half, a stylesheet with
  // no transitions defined at all would also satisfy every "reduce" assertion above.
  await page.emulateMedia({ reducedMotion: "no-preference" });

  const transformBeforeNoPref = await camera.getAttribute("transform");
  await page.getByTestId("zoom-out").click();
  const transformAfterNoPref = await camera.getAttribute("transform");
  expect(transformAfterNoPref).not.toBe(transformBeforeNoPref);

  const cameraDurationNoPref = await camera.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(cameraDurationNoPref).not.toBe("0s");

  await page.locator('[data-testid="map-asset"][data-asset-id="house"]').click();
  await expect(panel).toBeVisible();
  const panelDurationNoPref = await panel.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(panelDurationNoPref).not.toBe("0s");
});
