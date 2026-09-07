// STUB — phase 3. Pure pan/zoom maths, deliberately DOM-free so it is unit-testable
// without a browser. Returns wrong values so tests fail on their assertions.
export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number; }
export interface CameraState { readonly scale: number; readonly tx: number; readonly ty: number; }

export const MIN_SCALE = 1;
export const MAX_SCALE = 3;

export function clamp(_state: CameraState, _bounds: Rect, _viewport: Rect): CameraState {
  return { scale: NaN, tx: NaN, ty: NaN };
}
export function zoomTo(_state: CameraState, _scale: number, _focus: { x: number; y: number }): CameraState {
  return { scale: NaN, tx: NaN, ty: NaN };
}
export function fit(_object: Rect, _viewport: Rect): CameraState {
  return { scale: NaN, tx: NaN, ty: NaN };
}
