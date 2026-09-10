/**
 * Small polygon helpers shared by House.tsx / Garden.tsx / Car.tsx.
 *
 * Not part of the frozen layout.ts contract — these are plumbing for turning
 * `isoToScreen` corners into the flat `<polygon>` shapes the art files draw, and for
 * insetting a door/window/rust-spot into a sheared iso wall face so it follows the
 * wall's own perspective instead of sitting on it like a flat sticker.
 */

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** The five bands `healthBand()` produces, mirrored here as a literal union (no domain import). */
export type HealthBand = "immaculate" | "dusty" | "grubby" | "damaged" | "broken-down";

const BANDS: readonly HealthBand[] = ["immaculate", "dusty", "grubby", "damaged", "broken-down"];

/**
 * `House`/`Garden`/`Car` take `band: string` per the map contract, not the literal
 * union — the scene passes through whatever `healthBand()` produced. An unrecognised
 * string reads as the worst band, same reasoning as `healthBand()` itself: showing a
 * house as filthy on bad input is the failure that gets noticed, showing it as
 * immaculate is the one that does not.
 */
export function normalizeBand(band: string): HealthBand {
  return (BANDS as readonly string[]).includes(band) ? (band as HealthBand) : "broken-down";
}

/** Renders a list of points as the `points` attribute of an SVG `<polygon>`. */
export function poly(points: readonly Pt[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/** Moves a scene point straight up (screen-up, i.e. smaller y) by `h` pixels — an extrusion. */
export function up(p: Pt, h: number): Pt {
  return { x: p.x, y: p.y - h };
}

export function lerp(p: Pt, q: Pt, t: number): Pt {
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

/**
 * A small flat diamond centred at grid point `(gx, gy)`, `size` tiles across, built
 * from `isoToScreen` the same way every other shape here is — used for ground-level
 * accents (a weed patch, a flower, a rust spot's grime) that need to sit flush on the
 * dimetric grid rather than as a screen-aligned dot.
 */
export function groundPatch(
  isoToScreen: (gx: number, gy: number) => Pt,
  gx: number,
  gy: number,
  size: number,
): [Pt, Pt, Pt, Pt] {
  return [isoToScreen(gx - size, gy), isoToScreen(gx, gy - size), isoToScreen(gx + size, gy), isoToScreen(gx, gy + size)];
}

/**
 * Insets a sub-parallelogram into a wall quad `[bottomA, bottomB, topA, topB]`
 * (bottom edge bottomA→bottomB, top edge topA→topB, matching a wall's own shear), at
 * fractions `u0..u1` along the bottom/top edges and `v0..v1` from bottom to top. Used
 * to place a window, door, rust spot, or moss patch so it sits flush on a sheared iso
 * face rather than looking pasted on axis-aligned.
 */
export function insetQuad(
  bottomA: Pt,
  bottomB: Pt,
  topA: Pt,
  topB: Pt,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
): [Pt, Pt, Pt, Pt] {
  const bu0 = lerp(bottomA, bottomB, u0);
  const bu1 = lerp(bottomA, bottomB, u1);
  const tu0 = lerp(topA, topB, u0);
  const tu1 = lerp(topA, topB, u1);
  const p0 = lerp(bu0, tu0, v0);
  const p1 = lerp(bu0, tu0, v1);
  const p2 = lerp(bu1, tu1, v1);
  const p3 = lerp(bu1, tu1, v0);
  return [p0, p1, p2, p3];
}
