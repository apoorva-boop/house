// Pure pan/zoom maths for the map's camera. No DOM, no React, no @house/domain import,
// no Date.now() — this file must stay unit-testable in Node, and the browser tests
// depend on these exact exports and the MIN_SCALE/MAX_SCALE values.
//
// Coordinate convention, fixed by Camera.test.ts:
//   screenX = sceneX * scale + tx
//   sceneX  = (screenX - tx) / scale
// Every function below is written from that identity rather than derived independently
// per function — a bug here would be a bug everywhere the camera is used.

export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number; }
export interface CameraState { readonly scale: number; readonly tx: number; readonly ty: number; }

export const MIN_SCALE = 1;
export const MAX_SCALE = 3;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Where one axis's translation must land so the scaled bounds stay flush with the
 * viewport, or — when the scaled bounds are the smaller of the two — where it must land
 * to centre them instead.
 *
 * The clamp range is `[low, high]` built from "bounds' far edge touches the viewport's
 * far edge" and "bounds' near edge touches the viewport's near edge". `low <= high`
 * exactly when `scaledSpan >= viewportSpan`: below that size the range would be empty
 * or inverted, so clamping into it would either discard the caller's translation for no
 * reason or silently swap low and high. Centring is the sane thing to do there instead
 * — it's also what a shrunk-to-fit scene and a scene smaller than its viewport both
 * want, so there's no separate "too small" case to special-case away.
 */
function clampAxis(
  translation: number,
  boundsOrigin: number,
  boundsSpan: number,
  viewportOrigin: number,
  viewportSpan: number,
  scale: number,
): number {
  const scaledSpan = boundsSpan * scale;
  if (scaledSpan >= viewportSpan) {
    const low = viewportOrigin + viewportSpan - (boundsOrigin + boundsSpan) * scale;
    const high = viewportOrigin - boundsOrigin * scale;
    return clampNumber(translation, low, high);
  }
  return viewportOrigin + viewportSpan / 2 - (boundsOrigin + boundsSpan / 2) * scale;
}

/**
 * Keeps `bounds` (scene space) covering `viewport` (screen px) after a drag or a zoom.
 * Never touches `state.scale` — scale is `zoomTo`'s job, composed by the caller before
 * this runs. The two axes are judged independently: a scene tall enough to clamp
 * vertically but not wide enough to clamp horizontally centres on x and clamps on y in
 * the same call, which is what lets a portrait map and a landscape one share this one
 * function.
 */
export function clamp(state: CameraState, bounds: Rect, viewport: Rect): CameraState {
  const tx = clampAxis(state.tx, bounds.x, bounds.w, viewport.x, viewport.w, state.scale);
  const ty = clampAxis(state.ty, bounds.y, bounds.h, viewport.y, viewport.h, state.scale);
  return { scale: state.scale, tx, ty };
}

/**
 * Zooms to `scale` (clamped to [MIN_SCALE, MAX_SCALE]) while keeping the scene point
 * currently under `focus` — a screen point, e.g. a pinch centre or the viewport's
 * middle for the zoom buttons — under `focus` afterwards. Solve the coordinate identity
 * for that scene point under the old state, then solve it again for the `tx`/`ty` that
 * puts the same scene point back under the same screen point at the new scale:
 *   sceneX = (focus.x - state.tx) / state.scale
 *   tx'    = focus.x - sceneX * scale'
 * Deliberately does not clamp translation — `bounds` isn't in scope here, so a zoom
 * never has to know the scene's extent to stay correct. The MapPresenter composes
 * `clamp()` on the result instead.
 */
export function zoomTo(state: CameraState, scale: number, focus: { x: number; y: number }): CameraState {
  const clampedScale = clampNumber(scale, MIN_SCALE, MAX_SCALE);
  const sceneX = (focus.x - state.tx) / state.scale;
  const sceneY = (focus.y - state.ty) / state.scale;
  return {
    scale: clampedScale,
    tx: focus.x - sceneX * clampedScale,
    ty: focus.y - sceneY * clampedScale,
  };
}

/**
 * Frames `object` (scene space) inside `viewport` (screen px) at the largest scale that
 * still fits both axes, clamped to the camera's zoom range — so a tiny asset doesn't
 * zoom in past MAX_SCALE just because it's tiny, and an object bigger than the viewport
 * doesn't zoom out past MIN_SCALE trying to fit it whole. Centres by the same
 * axis-independent algebra as `clampAxis`'s centring branch, because framing an object
 * *is* centring it; there's no drag position to clamp against, so this goes straight to
 * that branch instead of routing through `clamp()` with a manufactured bounds rect.
 * Guards a zero-width or zero-height object rather than dividing by it — the resulting
 * scale falls back to whichever axis is still measurable.
 */
export function fit(object: Rect, viewport: Rect): CameraState {
  const widthScale = object.w !== 0 ? viewport.w / object.w : Number.POSITIVE_INFINITY;
  const heightScale = object.h !== 0 ? viewport.h / object.h : Number.POSITIVE_INFINITY;
  const scale = clampNumber(Math.min(widthScale, heightScale), MIN_SCALE, MAX_SCALE);
  return {
    scale,
    tx: viewport.x + viewport.w / 2 - (object.x + object.w / 2) * scale,
    ty: viewport.y + viewport.h / 2 - (object.y + object.h / 2) * scale,
  };
}
