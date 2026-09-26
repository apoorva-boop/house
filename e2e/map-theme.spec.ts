import { test, expect, type Page } from "@playwright/test";
import { installFakeServer, seedCredentials, type SnapshotData } from "./support/fakeServer";
import { contrastRatio, deltaE, parseCssColor, relativeLuminance, type Rgb } from "./support/colour";

// The map screen in both themes. `a11y.spec.ts › legible in light and dark` walks the
// chore list and stats; until this file the map -- the launch screen -- was in no theme
// test at all, and once rendered pixel-identical in both: a cream lot on a dark page.

const DAY_MS = 86_400_000;
const SCHEMES = ["light", "dark"] as const;

/** Text against its background: WCAG 2.1 AA for body text, the same bar a11y.spec.ts uses. */
const TEXT_CONTRAST_MIN = 4.5;

/**
 * An object's largest painted surface against the ground it stands on, as a CIE76
 * colour difference (see e2e/support/colour.ts for how to read the scale). Main's
 * palette gives its lowest value, the house's shaded wall at dusk, ΔE 20; a surface
 * painted the ground's own colour gives 0.
 */
const SURFACE_DELTA_E_MIN = 10;

/**
 * The lot against the page around it. The ground is a surface OF the page -- close in
 * tone to it, in both themes -- not a lit field sitting on a dark page, which is what
 * a light-only palette produced. Main gives 1.2:1 light and 1.5:1 dark; the failure
 * this guards against gave about 15:1.
 */
const GROUND_TO_PAGE_MAX = 3;

/**
 * ...and still a surface you can see: the lot's edge is what makes panning past the
 * property mean anything. A ground painted the page's own colour scores 0 here; main
 * gives 18 light and 20 dark.
 */
const GROUND_TO_PAGE_DELTA_E_MIN = 5;

function threeAssets(): SnapshotData {
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

/** The same property, with one overdue chore on the house so its panel has a row to read. */
function withOverdueHouseChore(): SnapshotData {
  const dueAt = new Date(Date.now() - 3 * DAY_MS).toISOString();
  return {
    ...threeAssets(),
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
  };
}

function rgbOf(value: string, what: string): Rgb {
  const parsed = parseCssColor(value);
  if (parsed === null) throw new Error(`${what}: could not read a colour from "${value}"`);
  return parsed.rgb;
}

/**
 * The computed fill of the largest opaque shape inside one asset's `<g>` -- its
 * dominant surface: the house's bigger wall, the lawn, the car's roof. Read off the
 * rendered elements, not the token table, so what is measured is what the theme
 * actually painted. The asset's hit silhouette (fill-opacity 0) is skipped. Polygons,
 * rects and circles are all the assets draw today; any other painted shape throws, so a
 * future asset whose biggest surface is a <path> fails here instead of being passed
 * over for a smaller polygon.
 */
async function dominantSurfaceFill(page: Page, assetId: string): Promise<{ fill: string; area: number }> {
  return page.locator(`[data-testid="map-asset"][data-asset-id="${assetId}"]`).evaluate((group) => {
    function polygonArea(points: string): number {
      const nums = points
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => !Number.isNaN(n));
      let sum = 0;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x1 = nums[i] ?? 0;
        const y1 = nums[i + 1] ?? 0;
        const x2 = nums[(i + 2) % nums.length] ?? 0;
        const y2 = nums[(i + 3) % nums.length] ?? 0;
        sum += x1 * y2 - x2 * y1;
      }
      return Math.abs(sum) / 2;
    }
    let best: { fill: string; area: number } | null = null;
    const shapes = Array.from(group.querySelectorAll("polygon, rect, circle, ellipse, path, polyline"));
    for (const el of shapes) {
      const style = getComputedStyle(el);
      if (style.fill === "none" || parseFloat(style.fillOpacity) === 0) continue;
      const tag = el.tagName.toLowerCase();
      const attr = (name: string) => parseFloat(el.getAttribute(name) ?? "0");
      let area: number;
      if (tag === "polygon") area = polygonArea(el.getAttribute("points") ?? "");
      else if (tag === "rect") area = attr("width") * attr("height");
      else if (tag === "circle") area = Math.PI * attr("r") * attr("r");
      else throw new Error(`map-asset ${group.getAttribute("data-asset-id")} paints a <${tag}>; teach dominantSurfaceFill its area`);
      if (best === null || area > best.area) best = { fill: style.fill, area };
    }
    if (best === null) throw new Error(`no painted shape inside map-asset ${group.getAttribute("data-asset-id")}`);
    return best;
  });
}

/** An element's text colour and the first fully opaque background behind it. */
async function textColours(page: Page, testId: string): Promise<{ text: string; background: string | null }> {
  return page.locator(`[data-testid="${testId}"]`).first().evaluate((el) => {
    const text = getComputedStyle(el).color;
    let node: Element | null = el;
    while (node !== null) {
      const bg = getComputedStyle(node).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      const alpha = m ? Number((m[1] ?? "").split(/[\s,/]+/).filter((s) => s !== "")[3] ?? 1) : 0;
      if (alpha === 1) return { text, background: bg };
      node = node.parentElement;
    }
    return { text, background: null };
  });
}

async function expectLegible(page: Page, testIds: readonly string[], scheme: string): Promise<void> {
  for (const testId of testIds) {
    const { text, background } = await textColours(page, testId);
    expect(background, `${testId} in ${scheme}: no opaque background behind it`).not.toBeNull();
    const ratio = contrastRatio(rgbOf(text, testId), rgbOf(background as string, testId));
    expect(ratio, `${testId} in ${scheme}: ${text} on ${background}`).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
  }
}

test("the scene follows the theme, and each object stands clear of the ground", async ({ page }) => {
  await installFakeServer(page, { snapshot: threeAssets() });
  await seedCredentials(page);

  const groundIn: Partial<Record<(typeof SCHEMES)[number], Rgb>> = {};

  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(page.getByTestId("map-screen")).toBeVisible();

    const groundFill = await page.locator('[data-art="ground"]').evaluate((el) => getComputedStyle(el).fill);
    const pageBackground = await page.getByTestId("map-screen").evaluate((el) => getComputedStyle(el).backgroundColor);
    const ground = rgbOf(groundFill, `ground in ${scheme}`);
    groundIn[scheme] = ground;

    expect(
      contrastRatio(ground, rgbOf(pageBackground, `page in ${scheme}`)),
      `ground ${groundFill} against the page ${pageBackground} in ${scheme}`,
    ).toBeLessThan(GROUND_TO_PAGE_MAX);
    expect(
      deltaE(ground, rgbOf(pageBackground, `page in ${scheme}`)),
      `ground ${groundFill} against the page ${pageBackground} in ${scheme}`,
    ).toBeGreaterThanOrEqual(GROUND_TO_PAGE_DELTA_E_MIN);

    for (const assetId of ["house", "garden", "car"] as const) {
      const surface = await dominantSurfaceFill(page, assetId);
      expect(
        deltaE(rgbOf(surface.fill, `${assetId} in ${scheme}`), ground),
        `${assetId}'s largest surface ${surface.fill} against the ground ${groundFill} in ${scheme}`,
      ).toBeGreaterThanOrEqual(SURFACE_DELTA_E_MIN);
    }
  }

  // The theme must actually reach the scene. Without this, a palette that ignores
  // prefers-color-scheme could still pass every per-theme check above twice over.
  expect(groundIn.dark).not.toEqual(groundIn.light);
  expect(relativeLuminance(groundIn.dark!)).toBeLessThan(relativeLuminance(groundIn.light!));
});

test("map controls and panels legible in light and dark", async ({ page }) => {
  await installFakeServer(page, { snapshot: withOverdueHouseChore() });
  await seedCredentials(page);

  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(page.getByTestId("map-screen")).toBeVisible();

    // The toolbar and the zoom buttons, drawn over the map.
    await expectLegible(page, ["nav-chores", "nav-stats", "nav-add", "zoom-in", "zoom-out"], scheme);

    // The asset panel, with a real chore row in it.
    await page.locator('[data-testid="map-asset"][data-asset-id="house"]').click();
    await expect(page.getByTestId("asset-panel")).toBeVisible();
    await expect(page.getByTestId("panel-chore-row")).toHaveCount(1);
    await expectLegible(
      page,
      ["panel-title", "panel-health", "panel-chore-title", "panel-chore-due", "panel-chore-tick", "panel-close"],
      scheme,
    );
    await page.getByTestId("panel-close").click();
    await expect(page.getByTestId("asset-panel")).toHaveCount(0);

    // The person panel.
    await page.locator('[data-testid="map-character"][data-person-id="p1"]').click();
    await expect(page.getByTestId("person-panel")).toBeVisible();
    await expectLegible(
      page,
      ["person-panel-name", "person-panel-tier", "person-panel-points", "person-panel-share", "panel-close"],
      scheme,
    );
    await page.getByTestId("panel-close").click();
    await expect(page.getByTestId("person-panel")).toHaveCount(0);
  }
});
