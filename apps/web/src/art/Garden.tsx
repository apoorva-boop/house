import { GARDEN_FOOTPRINT, GARDEN_LIFT, isoToScreen, shade } from "./layout.js";
import { groundPatch, poly, up, normalizeBand } from "./geometry.js";
import type { HealthBand } from "./geometry.js";

export interface GardenProps {
  readonly band: string;
}

interface GardenLook {
  readonly lawn: string;
  readonly hedge: string;
  readonly weeds: number; // scraggly patches over the lawn, 0-6
  readonly flowers: number; // tended flower dots, 3-0
}

const LOOK: Readonly<Record<HealthBand, GardenLook>> = {
  immaculate: { lawn: "#5fa050", hedge: "#3f7a3f", weeds: 0, flowers: 3 },
  dusty: { lawn: "#6e9a52", hedge: "#4a7a45", weeds: 1, flowers: 2 },
  grubby: { lawn: "#8a9a52", hedge: "#6b7245", weeds: 3, flowers: 1 },
  damaged: { lawn: "#a89552", hedge: "#5c5238", weeds: 5, flowers: 0 },
  "broken-down": { lawn: "#8a7550", hedge: "#4a4030", weeds: 6, flowers: 0 },
};

const FLOWER_COLORS = ["#d94f70", "#e0b23d", "#8a5fd9"];

/** Ground positions (grid coords) for the weed/flower accents, in a fixed order. */
const ACCENT_SPOTS: readonly [number, number][] = [
  [6.4, 2.4],
  [7.2, 1.4],
  [5.9, 3.2],
  [7.5, 3.1],
  [6.6, 1.1],
  [7.0, 2.8],
];

/**
 * The garden: a flat lawn diamond plus one hedge box, both on the shared grid. The
 * hedge is drawn exactly like a small house — top face + two walls, same light ramp —
 * so it agrees with House.tsx's tonal language rather than inventing its own.
 */
export function Garden({ band }: GardenProps) {
  const look = LOOK[normalizeBand(band)];

  const A = isoToScreen(GARDEN_FOOTPRINT.gx0, GARDEN_FOOTPRINT.gy0);
  const B = isoToScreen(GARDEN_FOOTPRINT.gx1, GARDEN_FOOTPRINT.gy0);
  const C = isoToScreen(GARDEN_FOOTPRINT.gx1, GARDEN_FOOTPRINT.gy1);
  const D = isoToScreen(GARDEN_FOOTPRINT.gx0, GARDEN_FOOTPRINT.gy1);

  // Hedge footprint: a small bed tucked into the garden's back corner, nearest the house.
  const hgx0 = 6.2;
  const hgy0 = 0.3;
  const hgx1 = 7.6;
  const hgy1 = 1.3;
  const hA = isoToScreen(hgx0, hgy0);
  const hB = isoToScreen(hgx1, hgy0);
  const hC = isoToScreen(hgx1, hgy1);
  const hD = isoToScreen(hgx0, hgy1);
  const hA2 = up(hA, GARDEN_LIFT);
  const hB2 = up(hB, GARDEN_LIFT);
  const hC2 = up(hC, GARDEN_LIFT);
  const hD2 = up(hD, GARDEN_LIFT);

  return (
    <g data-art="garden">
      {/* Lawn */}
      <polygon points={poly([A, B, C, D])} fill={shade(look.lawn, "top")} stroke="rgba(0,0,0,0.15)" strokeWidth={1} />

      {/* Weeds gone to seed, worst bands get more of them */}
      {ACCENT_SPOTS.slice(0, look.weeds).map(([gx, gy], i) => (
        <polygon key={`weed-${i}`} points={poly(groundPatch(isoToScreen, gx, gy, 0.22))} fill="#7a6a34" />
      ))}

      {/* Tended flowers, only while the garden is being kept up */}
      {ACCENT_SPOTS.slice(0, look.flowers).map(([gx, gy], i) => (
        <polygon
          key={`flower-${i}`}
          points={poly(groundPatch(isoToScreen, gx, gy, 0.14))}
          fill={FLOWER_COLORS[i % FLOWER_COLORS.length] ?? "#d94f70"}
        />
      ))}

      {/* Hedge */}
      <polygon points={poly([hA2, hB2, hC2, hD2])} fill={shade(look.hedge, "top")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
      <polygon points={poly([hB, hC, hC2, hB2])} fill={shade(look.hedge, "dark")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
      <polygon points={poly([hD, hC, hC2, hD2])} fill={shade(look.hedge, "mid")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
    </g>
  );
}
