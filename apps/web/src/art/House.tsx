import { HOUSE_FOOTPRINT, HOUSE_LIFT, isoToScreen } from "./layout.js";
import { shade, tone } from "./ArtTokens.js";
import { insetQuad, lerp, poly, up, normalizeBand } from "./geometry.js";
import type { HealthBand, Pt } from "./geometry.js";

export interface HouseProps {
  readonly band: string;
}

type WindowState = "clear" | "hazy" | "cracked" | "boarded";

interface HouseLook {
  readonly siding: string; // ArtTokens role name
  readonly roof: string; // ArtTokens role name
  readonly window: WindowState;
  readonly moss: number; // moss patches drawn on the shaded (left) wall, 0-3
  readonly patch: boolean; // a bare, missing-siding patch on the lit (right) wall
  readonly doorSkew: number; // px the door leans open, broken-down only
}

const LOOK: Readonly<Record<HealthBand, HouseLook>> = {
  immaculate: { siding: "house-siding-immaculate", roof: "house-roof-immaculate", window: "clear", moss: 0, patch: false, doorSkew: 0 },
  dusty: { siding: "house-siding-dusty", roof: "house-roof-dusty", window: "hazy", moss: 0, patch: false, doorSkew: 0 },
  grubby: { siding: "house-siding-grubby", roof: "house-roof-grubby", window: "hazy", moss: 1, patch: false, doorSkew: 0 },
  damaged: { siding: "house-siding-damaged", roof: "house-roof-damaged", window: "cracked", moss: 2, patch: true, doorSkew: 0 },
  "broken-down": {
    siding: "house-siding-broken-down",
    roof: "house-roof-broken-down",
    window: "boarded",
    moss: 3,
    patch: true,
    doorSkew: 7,
  },
};

/**
 * How `HOUSE_LIFT` (the silhouette's total rise, frozen by layout.ts) splits between
 * the walls and the roof's own peak. A flat-topped box put all of it into wall height;
 * a pitched roof needs some of it spent on a ridge instead, or the roof reads as a lid
 * rather than a roof.
 */
const RIDGE_LIFT = 46;
const EAVE_LIFT = HOUSE_LIFT - RIDGE_LIFT;

/**
 * The house: eaves-height walls under a gable roof, on the shared grid. Only the two
 * walls facing the camera are drawn (as before) — but the roof above them is now a
 * ridge, not a flat cap: a sloped face over the front (mid-tone) wall, and a triangular
 * gable end continuing the side (dark-tone) wall up to the same ridge point. That
 * silhouette — a peak, not a lid — is what makes this read as a house rather than a
 * shed at a glance. A doorstep at ground level and a second window (one per visible
 * wall) do the rest.
 */
export function House({ band }: HouseProps) {
  const look = LOOK[normalizeBand(band)];

  const B = isoToScreen(HOUSE_FOOTPRINT.gx1, HOUSE_FOOTPRINT.gy0); // right corner
  const C = isoToScreen(HOUSE_FOOTPRINT.gx1, HOUSE_FOOTPRINT.gy1); // front corner (closest to camera)
  const D = isoToScreen(HOUSE_FOOTPRINT.gx0, HOUSE_FOOTPRINT.gy1); // left corner
  const B2 = up(B, EAVE_LIFT);
  const C2 = up(C, EAVE_LIFT);
  const D2 = up(D, EAVE_LIFT);

  // The ridge runs the gx0->gx1 length at the footprint's mid-depth, at the peak
  // height. Its near end sits exactly above the visible side wall's mid-point — the
  // apex of that wall's gable triangle; its far end sits over the hidden back wall.
  const gyMid = (HOUSE_FOOTPRINT.gy0 + HOUSE_FOOTPRINT.gy1) / 2;
  const ridgeBack = up(isoToScreen(HOUSE_FOOTPRINT.gx0, gyMid), HOUSE_LIFT);
  const ridgeFront = up(isoToScreen(HOUSE_FOOTPRINT.gx1, gyMid), HOUSE_LIFT);

  // Side wall (B->C): faces away from the sun, darkest. Front wall (D->C): faces the sun, mid.
  const sideWall: [Pt, Pt, Pt, Pt] = [B, C, B2, C2];
  const frontWall: [Pt, Pt, Pt, Pt] = [D, C, D2, C2];

  const sideWindow = insetQuad(sideWall[0], sideWall[1], sideWall[2], sideWall[3], 0.14, 0.46, 0.32, 0.72);
  const frontWindow = insetQuad(frontWall[0], frontWall[1], frontWall[2], frontWall[3], 0.1, 0.38, 0.3, 0.68);
  const doorQuad = insetQuad(frontWall[0], frontWall[1], frontWall[2], frontWall[3], 0.55, 0.82, 0, 0.55).map((p, i) =>
    // The door leans open on broken-down: the top two corners (index 1, 2) shift sideways.
    i === 1 || i === 2 ? { x: p.x + look.doorSkew, y: p.y } : p,
  );
  // A flat step at the door's foot, sitting just below the ground line (negative `v`
  // on the same wall basis) rather than protruding past the footprint edge. `u` stays
  // clear of `bottomB` (corner C, already the footprint's own lowest/frontmost point)
  // so the dip below `v=0` never pushes past `ASSET_RECTS.house`'s bottom edge.
  const stepQuad = insetQuad(frontWall[0], frontWall[1], frontWall[2], frontWall[3], 0.5, 0.8, -0.1, 0.02);

  const mossSpots = Array.from({ length: look.moss }, (_, i) =>
    insetQuad(frontWall[0], frontWall[1], frontWall[2], frontWall[3], 0.08 + i * 0.14, 0.16 + i * 0.14, 0.05, 0.16),
  );

  const windowGlass = (quad: readonly [Pt, Pt, Pt, Pt]) => {
    if (look.window === "boarded") {
      return (
        <>
          <polygon points={poly(quad)} fill={tone("house-window-boarded")} />
          <line x1={quad[0].x} y1={quad[0].y} x2={quad[2].x} y2={quad[2].y} stroke={tone("house-window-boarded-line")} strokeWidth={2} />
          <line x1={quad[1].x} y1={quad[1].y} x2={quad[3].x} y2={quad[3].y} stroke={tone("house-window-boarded-line")} strokeWidth={2} />
        </>
      );
    }
    const glass = look.window === "clear" ? tone("house-window-glass-clear") : tone("house-window-glass-hazy");
    return (
      <>
        <polygon points={poly(quad)} fill={glass} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
        {look.window === "clear" && (
          <polygon
            points={poly([lerp(quad[0], quad[1], 0.55), lerp(quad[0], quad[1], 0.85), lerp(quad[3], quad[2], 0.85), lerp(quad[3], quad[2], 0.55)])}
            fill={tone("house-window-highlight")}
          />
        )}
        {look.window === "cracked" && (
          <polyline
            points={poly([quad[0], lerp(quad[0], quad[2], 0.4), lerp(quad[1], quad[3], 0.5), quad[3]])}
            fill="none"
            stroke={tone("house-window-crack-line")}
            strokeWidth={1.5}
          />
        )}
      </>
    );
  };

  return (
    <g data-art="house">
      {/* Doorstep */}
      <polygon points={poly(stepQuad)} fill={tone("house-step")} />

      {/* Roof: the sloped face over the front wall, and the gable triangle over the
          side wall, meeting at one ridge -- a peak, not a flat cap. */}
      <polygon points={poly([D2, C2, ridgeFront, ridgeBack])} fill={shade(look.roof, "top")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
      <polygon points={poly([B2, C2, ridgeFront])} fill={shade(look.siding, "dark")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />

      {/* Walls */}
      <polygon points={poly([B, C, C2, B2])} fill={shade(look.siding, "dark")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
      <polygon points={poly([D, C, C2, D2])} fill={shade(look.siding, "mid")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />

      {/* Bare-siding patch, damaged and broken-down only */}
      {look.patch && (
        <polygon
          points={poly(insetQuad(sideWall[0], sideWall[1], sideWall[2], sideWall[3], 0.62, 0.88, 0.05, 0.3))}
          fill={tone("house-patch")}
        />
      )}

      {/* Moss climbing the shaded wall, grubby and worse */}
      {mossSpots.map((spot, i) => (
        <polygon key={i} points={poly(spot)} fill={tone("house-moss")} />
      ))}

      {/* Windows: one per visible wall */}
      {windowGlass(sideWindow)}
      {windowGlass(frontWindow)}

      {/* Door */}
      <polygon points={poly(doorQuad)} fill={shade("house-door", "mid")} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
    </g>
  );
}
