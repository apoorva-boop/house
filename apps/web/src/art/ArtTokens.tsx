import { LIGHT_RAMP, type Face } from "./layout.js";

/**
 * The scene's whole colour palette, light and dark, in one place.
 *
 * Every colour anywhere in `apps/web/src/art/**` is a named *role* (e.g.
 * `"house-siding-grubby"`), never a literal hex — the literal hexes live only here, as a
 * `{ light, dark }` pair per role. `<ArtTokens/>` (rendered once by `Ground.tsx`) turns
 * this table into CSS custom properties on `:root`, overridden for dark under the same
 * `prefers-color-scheme` query `styles.css` uses for the rest of the app — so an object
 * drawn with `shade("house-siding-grubby", "mid")` or `tone("house-moss")` responds to
 * the OS theme with no JS of its own, exactly like every other colour in the app.
 *
 * Two tables:
 *
 * - `SURFACE_ROLES` — a role with faces: extruded geometry (a wall, a roof, a lawn)
 *   whose three visible tones come from `LIGHT_RAMP` (contract: one light direction,
 *   shared by every object). `shade(role, face)` reads these.
 * - `FLAT_ROLES` — a role with no faces: something painted as one flat tone regardless
 *   of orientation (glass, rust, a doorstep, a character's skin). `tone(role)` reads
 *   these.
 *
 * Dusk, not "the same picture, darker": most `dark` values here are cooler and deeper
 * than a straight darkening of `light` would give, and the house/car glass roles turn
 * warm (lit windows) rather than merely dimmer — see the comments below.
 */

interface RoleColor {
  readonly light: string;
  readonly dark: string;
}

const SURFACE_ROLES: Readonly<Record<string, RoleColor>> = {
  ground: { light: "#c7bd9e", dark: "#232c38" },

  "house-siding-immaculate": { light: "#e4ddc9", dark: "#7d8797" },
  "house-siding-dusty": { light: "#d7cfb8", dark: "#6f7686" },
  "house-siding-grubby": { light: "#b7a988", dark: "#5c5f68" },
  "house-siding-damaged": { light: "#a08f6c", dark: "#4a4550" },
  "house-siding-broken-down": { light: "#847357", dark: "#3a3440" },

  "house-roof-immaculate": { light: "#7d8a8f", dark: "#48566b" },
  "house-roof-dusty": { light: "#8a8474", dark: "#4a4a52" },
  "house-roof-grubby": { light: "#726b54", dark: "#3c3a3c" },
  "house-roof-damaged": { light: "#5f5a45", dark: "#2f2d30" },
  "house-roof-broken-down": { light: "#4a4536", dark: "#201f22" },

  "house-door": { light: "#2f4f3a", dark: "#24402f" },

  "garden-lawn-immaculate": { light: "#5fa050", dark: "#2f5a3a" },
  "garden-lawn-dusty": { light: "#6e9a52", dark: "#3a5a38" },
  // Worse bands stay green-ish (patchy olive), never straight dirt-brown — a garden in
  // bad condition should still read as a garden, not a building site.
  "garden-lawn-grubby": { light: "#82964f", dark: "#454f34" },
  "garden-lawn-damaged": { light: "#93924f", dark: "#4f4f38" },
  "garden-lawn-broken-down": { light: "#8a7e50", dark: "#4a4636" },

  // Shared by the hedge and the tree canopy, so both agree on the garden's condition.
  "garden-foliage-immaculate": { light: "#3f7a3f", dark: "#22422a" },
  "garden-foliage-dusty": { light: "#4a7a45", dark: "#274228" },
  // The worst two bands stay recognisably PLANT — a dying shrub is yellow and olive,
  // not grey-brown. Taken to brown they read as rocks or rubble, and the garden stops
  // being a garden, which is the one thing a band is not allowed to change.
  "garden-foliage-grubby": { light: "#77803f", dark: "#3d4526" },
  "garden-foliage-damaged": { light: "#7d7a33", dark: "#403c1d" },
  "garden-foliage-broken-down": { light: "#6e6a2e", dark: "#35331a" },

  "car-body-immaculate": { light: "#3a6ea5", dark: "#274a70" },
  "car-body-dusty": { light: "#3f6690", dark: "#2c4763" },
  "car-body-grubby": { light: "#4a5f78", dark: "#333f4f" },
  "car-body-damaged": { light: "#57584f", dark: "#35352f" },
  "car-body-broken-down": { light: "#4b453d", dark: "#2a2621" },

  "character-shirt": { light: "#c9603f", dark: "#a04a30" },
  "character-pants": { light: "#3a3a3a", dark: "#242424" },
};

const FLAT_ROLES: Readonly<Record<string, RoleColor>> = {
  // House windows turn warm and lit after dark rather than merely dimmer — an occupied
  // house glows at dusk. Boarded stays black either way: nobody is home to light it.
  "house-window-glass-clear": { light: "#bfe3f2", dark: "#ffdb7a" },
  "house-window-highlight": { light: "#eaf6fb", dark: "#fff2c2" },
  "house-window-glass-hazy": { light: "#8f9c9c", dark: "#caa564" },
  "house-window-crack-line": { light: "#2b2b2b", dark: "#0d0d0d" },
  "house-window-boarded": { light: "#5a4630", dark: "#241a10" },
  "house-window-boarded-line": { light: "#3c2f1f", dark: "#120d08" },

  "house-moss": { light: "#3d4a34", dark: "#26301f" },
  "house-patch": { light: "#5c5240", dark: "#33302a" },
  "house-step": { light: "#9c958a", dark: "#4a4d55" },

  "garden-weed": { light: "#7a6a34", dark: "#4a4022" },
  "garden-flower-1": { light: "#d94f70", dark: "#b23a58" },
  "garden-flower-2": { light: "#e0b23d", dark: "#b8912e" },
  "garden-flower-3": { light: "#8a5fd9", dark: "#6a48ad" },
  "garden-bed": { light: "#7a5a3a", dark: "#3f2e1f" },
  "tree-trunk": { light: "#6b4a2f", dark: "#3a281a" },

  // Car glass stays dark/cool at dusk (reflecting the sky) rather than glowing, unlike
  // the house's lit windows -- a parked car has no one inside to light it.
  "car-window-clear": { light: "#dff0f7", dark: "#4a6478" },
  "car-window-highlight": { light: "#f4fbff", dark: "#8fd0ea" },
  "car-window-hazy": { light: "#9fb2b5", dark: "#3a454a" },
  "car-window-dirty": { light: "#7c8a8c", dark: "#2c3336" },
  "car-window-crack-line": { light: "#20201f", dark: "#0a0a0a" },
  "car-wheel": { light: "#1c1c1c", dark: "#0a0a0a" },
  "car-hubcap": { light: "#8a8a8a", dark: "#55575c" },
  "car-rust": { light: "#7a3f22", dark: "#4a2615" },
  "car-dent": { light: "#2f3a2f", dark: "#1a201a" },

  "character-skin": { light: "#e8b98f", dark: "#c99a72" },
  "character-sweat": { light: "#8ec9e8", dark: "#6fa8c9" },
  "character-brow": { light: "#4a3324", dark: "#2e2013" },
  "character-eye": { light: "#2a2a2a", dark: "#1c1c1c" },
  "character-mouth": { light: "#7a3c2a", dark: "#5c2e1e" },
};

const FACES: readonly Face[] = ["top", "mid", "dark"];

/** Applies `LIGHT_RAMP[face]` to a `#rrggbb` literal — the arithmetic `shade()` used to
 * do directly on a raw colour. Now it runs once per role/face/theme, at token-declaration
 * time, over the two literals in the tables above, rather than on every render. */
function applyRamp(hex: string, face: Face): string {
  const m = LIGHT_RAMP[face];
  const n = hex.replace("#", "");
  const r = Math.min(255, Math.round(parseInt(n.slice(0, 2), 16) * m));
  const g = Math.min(255, Math.round(parseInt(n.slice(2, 4), 16) * m));
  const b = Math.min(255, Math.round(parseInt(n.slice(4, 6), 16) * m));
  const hex2 = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

function surfaceVarName(role: string, face: Face): string {
  return `--art-${role}-${face}`;
}

function flatVarName(role: string): string {
  return `--art-${role}`;
}

/**
 * `shade(role, face)` — the only sanctioned way to tone a face of an extruded surface.
 * Mirrors the old `layout.ts` signature exactly (a role name stands in for the literal
 * hex it used to take), so every call site in House/Garden/Car/Character reads the same
 * as before; only the LOOK tables' string literals changed, from hex to role name.
 */
export function shade(role: string, face: Face): string {
  return `var(${surfaceVarName(role, face)})`;
}

/** `tone(role)` — a flat colour with no face, e.g. glass, rust, a doorstep. */
export function tone(role: string): string {
  return `var(${flatVarName(role)})`;
}

function declarationsFor(mode: "light" | "dark"): string {
  const lines: string[] = [];
  for (const [role, color] of Object.entries(SURFACE_ROLES)) {
    for (const face of FACES) {
      lines.push(`${surfaceVarName(role, face)}: ${applyRamp(color[mode], face)};`);
    }
  }
  for (const [role, color] of Object.entries(FLAT_ROLES)) {
    lines.push(`${flatVarName(role)}: ${color[mode]};`);
  }
  return lines.join("\n");
}

/**
 * Declares every `--art-*` custom property this module names, light values on `:root`
 * and dark values under `@media (prefers-color-scheme: dark)` — the same query
 * `styles.css` uses. Rendered exactly once, by `Ground.tsx`, inside the scene: after
 * that, every `shade()`/`tone()` call anywhere in the art is just a `var()` reference
 * and needs no JS media-query logic of its own to react to the OS theme.
 */
export function ArtTokens() {
  return (
    <style>{`:root {
${declarationsFor("light")}
}
@media (prefers-color-scheme: dark) {
  :root {
${declarationsFor("dark")}
  }
}`}</style>
  );
}
