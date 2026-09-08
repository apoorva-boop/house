/**
 * Shared isometric grid, light direction, and scene layout for every art asset.
 *
 * This file is deliberately the first thing WU16 lands and the last thing it changes:
 * the map view and the presenters' `fitAsset` both key off `isoToScreen`,
 * `SCENE_BOUNDS` and `ASSET_RECTS`, so their shapes are frozen once other work depends
 * on them.
 *
 * `apps/web/src/art/**` may not import `@house/domain` — only `packages/domain`'s
 * *shape* (health bands, fairness tiers) is known here, as literal numbers, never the
 * package itself.
 */

// ---------------------------------------------------------------------------
// The grid: 2:1 dimetric projection
// ---------------------------------------------------------------------------

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Half the tile height/width come up often enough (every corner) to name once. */
export const TILE_H = 24;
export const TILE_W = TILE_H * 2; // 48 — kept as a literal multiple of TILE_H so the 2:1 ratio can never drift apart under a future edit.

/**
 * The one conversion from grid space to scene-pixel space. Every object in
 * House.tsx / Garden.tsx / Car.tsx places its geometry by calling this — nothing is
 * hand-positioned in a way that could fall off the dimetric grid.
 */
export function isoToScreen(gx: number, gy: number): { x: number; y: number } {
  return {
    x: ((gx - gy) * TILE_W) / 2,
    y: ((gx + gy) * TILE_H) / 2,
  };
}

// ---------------------------------------------------------------------------
// Light direction: chosen once, shared by every object
// ---------------------------------------------------------------------------

/**
 * The sun sits over the upper-left of the scene. Every extruded shape in this module
 * is built from three faces, and each face's tone comes from this ramp rather than a
 * colour the object picks for itself:
 *
 * - `top`  — an upward-facing plane (a roof, a car's cabin top, a hedge's crown):
 *            brightest, catches the most light.
 * - `mid`  — the wall/side facing toward the sun (the "D→C" edge in this file's
 *            corner naming below, i.e. the left-hand face as drawn): middle tone.
 * - `dark` — the wall/side facing away from the sun (the "B→C" edge, the right-hand
 *            face as drawn): darkest.
 *
 * Keeping this rule in one place is what stops the scene looking pasted together —
 * every object agrees on where the sun is.
 */
export const LIGHT_RAMP = {
  top: 1.18,
  mid: 1.0,
  dark: 0.72,
} as const;

export type Face = keyof typeof LIGHT_RAMP;

/** Applies LIGHT_RAMP to a `#rrggbb` literal. The only sanctioned way to tone a face. */
export function shade(hex: string, face: Face): string {
  const m = LIGHT_RAMP[face];
  const n = hex.replace("#", "");
  const r = Math.min(255, Math.round(parseInt(n.slice(0, 2), 16) * m));
  const g = Math.min(255, Math.round(parseInt(n.slice(2, 4), 16) * m));
  const b = Math.min(255, Math.round(parseInt(n.slice(4, 6), 16) * m));
  const hex2 = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

// ---------------------------------------------------------------------------
// Scene layout: one property, not three shapes in a row
// ---------------------------------------------------------------------------
//
// Grid footprints, in tile units (gx right-down axis, gy left-down axis). The garden
// shares the house's gx=5 edge — it sits *beside* the house, not apart from it — and
// the car's footprint is nested inside the house's own gx span, in front of its gy=4
// frontage, i.e. on a driveway the house and garden both open onto. Read top-down:
//
//        gy=0      gy=4      gy=6
//   gx=0  ┌──────────┬─────────┐
//         │  house   │ garden  │
//   gx=1  │      ┌───┴─────────┘
//         │      │car│
//   gx=3  └──────┴───┘
//
// (ASCII art is approximate — the real shape comes from the corner maths below, which
// is what SCENE_BOUNDS is actually checked against.)

interface Footprint {
  readonly gx0: number;
  readonly gy0: number;
  readonly gx1: number;
  readonly gy1: number;
}

export const HOUSE_FOOTPRINT: Footprint = { gx0: 0, gy0: 0, gx1: 5, gy1: 4 };
export const GARDEN_FOOTPRINT: Footprint = { gx0: 5, gy0: 0, gx1: 8, gy1: 4 };
export const CAR_FOOTPRINT: Footprint = { gx0: 1, gy0: 4, gx1: 3, gy1: 6 };

/** Scene-pixel height each object's silhouette rises above its footprint's ground line. */
export const HOUSE_LIFT = 110; // flat-roofed box: walls + roof cap combined
export const GARDEN_LIFT = 20; // hedge crown
export const CAR_LIFT = 34; // cabin roof

function footprintRect(f: Footprint, lift: number): Rect {
  const corners = [
    isoToScreen(f.gx0, f.gy0),
    isoToScreen(f.gx1, f.gy0),
    isoToScreen(f.gx1, f.gy1),
    isoToScreen(f.gx0, f.gy1),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys) - lift; // the extrusion only ever rises (screen-up = smaller y), never sinks below ground
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Each object's box in scene pixels, for zoom-to-fit. Keys are the asset ids. */
export const ASSET_RECTS: Readonly<Record<"house" | "garden" | "car", Rect>> = {
  house: footprintRect(HOUSE_FOOTPRINT, HOUSE_LIFT),
  garden: footprintRect(GARDEN_FOOTPRINT, GARDEN_LIFT),
  car: footprintRect(CAR_FOOTPRINT, CAR_LIFT),
};

/** The least grounds the property may sit in, whatever else the sizing below decides. */
const MIN_MARGIN = 24;

function union(rects: readonly Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const assetsBounds = union(Object.values(ASSET_RECTS));

// The smallest screen in the tested range (375x667 through 430x932), portrait.
const MIN_VIEWPORT_W = 375;
const MIN_VIEWPORT_H = 667;

/**
 * How far the camera can travel each way from centre at scale 1, on that smallest
 * screen. This is the number that makes panning mean anything.
 *
 * `Camera.clamp()` centres an axis whose scaled bounds are SMALLER than the viewport —
 * there is nowhere to go, so it refuses to pretend otherwise. Sized to the property plus
 * a tidy margin, the scene would be 360x302 against a 375x667 viewport, both axes
 * smaller, and the map would be unpannable at its own default zoom. The property fitting
 * on screen and the map being draggable are not in tension; they just need the grounds to
 * be bigger than the window looking at them.
 */
const PAN_TRAVEL_X = 92;
const PAN_TRAVEL_Y = 76;

const SCENE_W = Math.max(assetsBounds.w + MIN_MARGIN * 2, MIN_VIEWPORT_W + PAN_TRAVEL_X * 2);
const SCENE_H = Math.max(assetsBounds.h + MIN_MARGIN * 2, MIN_VIEWPORT_H + PAN_TRAVEL_Y * 2);

/**
 * The whole lot in scene pixels: the property, centred in the grounds around it. The
 * camera clamps against this, and `Ground.tsx` draws it.
 *
 * Two things are true of it at once, and both are asserted by browser tests.
 *
 * **All three objects fit a 375x667 viewport at scale 1.** `assetsBounds` is computed
 * from the footprint corners through `isoToScreen`, the same function every object draws
 * with, so it is derived rather than guessed: x:[-120,192] = 312 wide, y:[-110,144] = 254
 * tall. Centred, that leaves 31px of slack each side horizontally and 206px vertically. A
 * future footprint or lift edit that overflows the width changes this immediately instead
 * of silently.
 *
 * **The map can be dragged.** 559x819 against 375x667 gives 92px of travel each way
 * horizontally and 76px vertically — comfortably more than any single drag, rather than a
 * figure that only just clears a test.
 *
 * And the property can never be lost off-screen, which is the clamp's whole purpose: at
 * the furthest horizontal pan the window still holds 251 of the property's 312 pixels,
 * and vertically it holds all 254 at both extremes. You can look around the grounds; you
 * cannot lose the house.
 */
export const SCENE_BOUNDS: Rect = {
  x: assetsBounds.x + assetsBounds.w / 2 - SCENE_W / 2,
  y: assetsBounds.y + assetsBounds.h / 2 - SCENE_H / 2,
  w: SCENE_W,
  h: SCENE_H,
};
