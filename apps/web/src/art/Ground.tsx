import { SCENE_BOUNDS, shade } from "./layout.js";

/**
 * The lot the property stands on: a single flat plane filling `SCENE_BOUNDS` exactly,
 * lit by the same `LIGHT_RAMP` as every other object (top face, since it is a plane
 * seen from directly above rather than an extrusion with visible sides).
 *
 * Two things depend on it existing at all:
 *
 * - It is what makes panning *mean* anything. Without something drawn across the
 *   whole scene, dragging past the property would just reveal empty svg background,
 *   indistinguishable from a camera that never moved.
 * - `map.spec.ts › drag pans` reads the camera group's own rendered bounding box and
 *   requires it to still cover the `<svg>` after a drag past the clamp — which needs
 *   an element inside the camera group that actually spans `SCENE_BOUNDS`, not just
 *   the three (much smaller) asset groups.
 *
 * It is pure scenery: no `data-testid`, not focusable, and `pointer-events: none` so
 * it never steals a click or a drag start meant for one of the three assets drawn
 * over it.
 */
export function Ground() {
  const { x, y, w, h } = SCENE_BOUNDS;
  return (
    <rect data-art="ground" x={x} y={y} width={w} height={h} fill={shade("#c7bd9e", "top")} pointerEvents="none" />
  );
}
