/**
 * Colour maths for the theme tests, run in Node on strings the page hands back from
 * `getComputedStyle`. Two measures, because they answer two different questions:
 *
 * - `contrastRatio` — WCAG 2.1's relative-luminance ratio (1.4.3). The right bar for
 *   TEXT on a background: 4.5:1 for body text. It is luminance only; two colours of
 *   the same brightness score 1:1 however different their hue.
 * - `deltaE` — CIE76, the Euclidean distance in CIELAB. The right question for one
 *   PAINTED SURFACE next to another: "would a person see these as two different
 *   colours?" Roughly: under 2 is not noticeable, 5 is a visible difference, 10 and
 *   above is plainly two colours. The map's dusk palette separates a blue car from a
 *   slate ground by hue at similar brightness -- 1.7:1 on the WCAG scale, ΔE 24 -- and
 *   the lead approved it by eye, so a luminance-only bar would either fail the
 *   approved art or be set too low to mean anything.
 */

export type Rgb = readonly [number, number, number];

export interface CssColor {
  readonly rgb: Rgb;
  readonly alpha: number;
}

/** Parses the `rgb(r, g, b)` / `rgba(r, g, b, a)` form Chromium's computed styles use. */
export function parseCssColor(value: string): CssColor | null {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = (m[1] ?? "")
    .split(/[\s,/]+/)
    .filter((s) => s !== "")
    .map(Number);
  const [r, g, b] = parts;
  if (r === undefined || g === undefined || b === undefined) return null;
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return { rgb: [r, g, b], alpha: parts[3] ?? 1 };
}

function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.1 contrast ratio, 1:1 (identical) to 21:1 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a) + 0.05;
  const l2 = relativeLuminance(b) + 0.05;
  return l1 > l2 ? l1 / l2 : l2 / l1;
}

/** sRGB → CIELAB, D65 reference white. */
function toLab([r, g, b]: Rgb): readonly [number, number, number] {
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = (lr * 0.2126 + lg * 0.7152 + lb * 0.0722) / 1.0;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference. See the header for how to read the number. */
export function deltaE(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
