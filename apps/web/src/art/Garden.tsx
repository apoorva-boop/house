import { GARDEN_FOOTPRINT, GARDEN_LIFT, isoToScreen } from "./layout.js";
import { shade, tone } from "./ArtTokens.js";
import { groundPatch, poly, up, normalizeBand } from "./geometry.js";
import type { HealthBand, Pt } from "./geometry.js";

export interface GardenProps {
  readonly band: string;
}

interface GardenLook {
  readonly lawn: string; // ArtTokens role name
  readonly foliage: string; // ArtTokens role name, shared by hedge and tree canopy
  readonly weeds: number; // scraggly patches over the lawn, 0-6
  readonly flowers: number; // tended flower dots, 3-0
}

const LOOK: Readonly<Record<HealthBand, GardenLook>> = {
  immaculate: { lawn: "garden-lawn-immaculate", foliage: "garden-foliage-immaculate", weeds: 0, flowers: 3 },
  dusty: { lawn: "garden-lawn-dusty", foliage: "garden-foliage-dusty", weeds: 1, flowers: 2 },
  grubby: { lawn: "garden-lawn-grubby", foliage: "garden-foliage-grubby", weeds: 3, flowers: 1 },
  damaged: { lawn: "garden-lawn-damaged", foliage: "garden-foliage-damaged", weeds: 5, flowers: 0 },
  "broken-down": { lawn: "garden-lawn-broken-down", foliage: "garden-foliage-broken-down", weeds: 6, flowers: 0 },
};

const FLOWER_ROLES = ["garden-flower-1", "garden-flower-2", "garden-flower-3"];

/** Ground positions (grid coords) for the weed/flower accents, in a fixed order. */
const ACCENT_SPOTS: readonly [number, number][] = [
  [6.4, 2.4],
  [7.2, 1.4],
  [5.9, 3.2],
  [7.5, 3.1],
  [6.6, 1.1],
  [7.0, 2.8],
];

/** Grid position of the tree, tucked into a corner the hedge doesn't already occupy. */
const TREE_GX = 5.9;
const TREE_GY = 2.85;
const TRUNK_LIFT = 32;
const CANOPY_LIFT = GARDEN_LIFT; // the tallest point in the garden's silhouette

/**
 * An 8-point blob centred at grid point `(gx, gy)`, lofted to `lift` — the tree's
 * canopy. A 4-point `groundPatch` diamond reads as a crate (it is exactly the hedge's
 * plan shape); this rounds it off enough to read as foliage instead, while staying a
 * flat polygon (no filter, no blur).
 */
function canopyBlob(gx: number, gy: number, r: number, lift: number): readonly Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    pts.push(up(isoToScreen(gx + Math.cos(angle) * r, gy + Math.sin(angle) * r), lift));
  }
  return pts;
}

/**
 * The garden: a flat lawn diamond, a flower bed, a hedge, and a tree, all on the
 * shared grid. Condition changes what you can see — fewer flowers, more weeds, a
 * patchier lawn, a barer tree — but a lawn, a bed, a hedge and a tree stay visible in
 * every band, so "garden" never stops being the first thing this reads as.
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
  const HEDGE_LIFT = 20;
  const hA2 = up(hA, HEDGE_LIFT);
  const hB2 = up(hB, HEDGE_LIFT);
  const hC2 = up(hC, HEDGE_LIFT);
  const hD2 = up(hD, HEDGE_LIFT);

  // Flower bed: a soil patch under the flower accents so they read as tended, not as
  // dots floating on the lawn. Present at every band -- weeds spread over it once the
  // garden is going unkept, same as the lawn around it.
  const bed = groundPatch(isoToScreen, 6.6, 2.6, 0.85);

  // Tree: a trunk plus a two-tone canopy (a lit top blob over a shaded under blob,
  // both flat -- no blur, no filter) lofted above it, the crown sitting right on the
  // trunk rather than floating apart from it.
  const trunkBase = isoToScreen(TREE_GX, TREE_GY);
  const trunkTop = up(trunkBase, TRUNK_LIFT);
  const trunkQuad: [Pt, Pt, Pt, Pt] = [
    { x: trunkBase.x - 4, y: trunkBase.y },
    { x: trunkBase.x + 4, y: trunkBase.y },
    { x: trunkTop.x + 4, y: trunkTop.y },
    { x: trunkTop.x - 4, y: trunkTop.y },
  ];
  const canopyShadow = canopyBlob(TREE_GX + 0.12, TREE_GY + 0.1, 0.58, TRUNK_LIFT + 2);
  const canopyMain = canopyBlob(TREE_GX, TREE_GY, 0.66, CANOPY_LIFT);

  return (
    <g data-art="garden">
      {/* Lawn */}
      <polygon points={poly([A, B, C, D])} fill={shade(look.lawn, "top")} stroke="rgba(0,0,0,0.15)" strokeWidth={1} />

      {/* Flower bed soil */}
      <polygon points={poly(bed)} fill={tone("garden-bed")} />

      {/* Weeds gone to seed, worst bands get more of them */}
      {ACCENT_SPOTS.slice(0, look.weeds).map(([gx, gy], i) => (
        <polygon key={`weed-${i}`} points={poly(groundPatch(isoToScreen, gx, gy, 0.24))} fill={tone("garden-weed")} />
      ))}

      {/* Tended flowers, only while the garden is being kept up */}
      {ACCENT_SPOTS.slice(0, look.flowers).map(([gx, gy], i) => (
        <polygon
          key={`flower-${i}`}
          points={poly(groundPatch(isoToScreen, gx, gy, 0.16))}
          fill={tone(FLOWER_ROLES[i % FLOWER_ROLES.length] ?? "garden-flower-1")}
        />
      ))}

      {/* Tree */}
      <polygon points={poly(trunkQuad)} fill={tone("tree-trunk")} />
      <polygon points={poly(canopyShadow)} fill={shade(look.foliage, "dark")} />
      <polygon points={poly(canopyMain)} fill={shade(look.foliage, "top")} stroke="rgba(0,0,0,0.15)" strokeWidth={1} />

      {/* Hedge */}
      <polygon points={poly([hA2, hB2, hC2, hD2])} fill={shade(look.foliage, "top")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
      <polygon points={poly([hB, hC, hC2, hB2])} fill={shade(look.foliage, "dark")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
      <polygon points={poly([hD, hC, hC2, hD2])} fill={shade(look.foliage, "mid")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
    </g>
  );
}
