import type { Page } from "@playwright/test";

/**
 * Gesture helpers for the map. Playwright has no built-in pinch, and `page.mouse` alone
 * cannot produce a genuine two-finger touch sequence, so `pinch` goes underneath
 * Playwright and drives Chrome's own touch input via CDP (`Input.dispatchTouchEvent`).
 * That makes the browser synthesize real Pointer Events (`pointerType: "touch"`) the
 * same way it would for an actual finger, rather than this file constructing
 * PointerEvents by hand, which a page could distinguish from the real thing (and which
 * a real user could not fire). Callers need `test.use({ hasTouch: true })`.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A drag: pointer down at `from`, a handful of intermediate moves, pointer up at `to`. */
export async function pan(page: Page, opts: { from: Point; to: Point; steps?: number }): Promise<void> {
  const { from, to, steps = 8 } = opts;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
}

interface TouchPointsAt {
  (distance: number): readonly [Point, Point];
}

/**
 * A two-finger pinch centred on `center`, moving from `startDistance` to `endDistance`
 * (the total finger-to-finger distance, in CSS px, along the x-axis) over `steps`
 * intermediate touch-move events. A shrinking distance pinches in (zooms out); a
 * growing one pinches out (zooms in).
 */
export async function pinch(
  page: Page,
  opts: { center: Point; startDistance: number; endDistance: number; steps?: number },
): Promise<void> {
  const { center, startDistance, endDistance, steps = 10 } = opts;
  const cdp = await page.context().newCDPSession(page);

  const pointsAt: TouchPointsAt = (distance) => [
    { x: center.x - distance / 2, y: center.y },
    { x: center.x + distance / 2, y: center.y },
  ];

  async function dispatch(type: "touchStart" | "touchMove" | "touchEnd", points: readonly Point[]): Promise<void> {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
    });
  }

  await dispatch("touchStart", pointsAt(startDistance));
  for (let i = 1; i <= steps; i++) {
    const distance = startDistance + ((endDistance - startDistance) * i) / steps;
    await dispatch("touchMove", pointsAt(distance));
  }
  // touchEnd carries the touches that remain -- both fingers lift, so none.
  await dispatch("touchEnd", []);
}
