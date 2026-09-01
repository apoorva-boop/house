import { describe, expect, it } from "vitest";
import { clamp, fit, MAX_SCALE, MIN_SCALE, zoomTo, type CameraState, type Rect } from "./Camera.js";

const VIEWPORT: Rect = { x: 0, y: 0, w: 375, h: 667 };
const SCENE: Rect = { x: 0, y: 0, w: 1000, h: 800 };

describe("clamp", () => {
  it("never places the scene bounds outside the viewport", () => {
    const dragged: CameraState = { scale: 1, tx: 99_999, ty: 99_999 };
    const result = clamp(dragged, SCENE, VIEWPORT);
    expect(result.tx).toBeLessThanOrEqual(0);
    expect(result.tx).toBeGreaterThanOrEqual(VIEWPORT.w - SCENE.w * result.scale);
  });

  it("clamps in the negative direction too", () => {
    const result = clamp({ scale: 1, tx: -99_999, ty: -99_999 }, SCENE, VIEWPORT);
    expect(result.tx).toBeGreaterThanOrEqual(VIEWPORT.w - SCENE.w * result.scale);
  });

  it("leaves an in-bounds camera untouched", () => {
    const inBounds: CameraState = { scale: 1, tx: -100, ty: -50 };
    expect(clamp(inBounds, SCENE, VIEWPORT)).toEqual(inBounds);
  });
});

describe("zoomTo", () => {
  it("clamps at the lower bound", () => {
    expect(zoomTo({ scale: 1, tx: 0, ty: 0 }, 0.2, { x: 187, y: 333 }).scale).toBe(MIN_SCALE);
  });

  it("clamps at the upper bound", () => {
    expect(zoomTo({ scale: 1, tx: 0, ty: 0 }, 9, { x: 187, y: 333 }).scale).toBe(MAX_SCALE);
  });

  it("keeps the focus point stationary", () => {
    const focus = { x: 200, y: 300 };
    const before: CameraState = { scale: 1, tx: -50, ty: -50 };
    const after = zoomTo(before, 2, focus);
    const sceneXBefore = (focus.x - before.tx) / before.scale;
    const sceneXAfter = (focus.x - after.tx) / after.scale;
    expect(sceneXAfter).toBeCloseTo(sceneXBefore, 5);
  });
});

describe("fit", () => {
  it("centres the object's bounding box in the viewport", () => {
    const object: Rect = { x: 400, y: 300, w: 200, h: 150 };
    const cam = fit(object, VIEWPORT);
    const centreX = (object.x + object.w / 2) * cam.scale + cam.tx;
    expect(centreX).toBeCloseTo(VIEWPORT.w / 2, 1);
  });

  it("never exceeds the zoom clamp", () => {
    const tiny: Rect = { x: 0, y: 0, w: 10, h: 10 };
    const cam = fit(tiny, VIEWPORT);
    expect(cam.scale).toBeLessThanOrEqual(MAX_SCALE);
    expect(cam.scale).toBeGreaterThanOrEqual(MIN_SCALE);
  });
});
