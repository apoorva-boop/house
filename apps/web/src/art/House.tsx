import { HOUSE_FOOTPRINT, HOUSE_LIFT, isoToScreen, shade } from "./layout.js";
import { insetQuad, lerp, poly, up, normalizeBand } from "./geometry.js";
import type { HealthBand, Pt } from "./geometry.js";

export interface HouseProps {
  readonly band: string;
}

type WindowState = "clear" | "hazy" | "cracked" | "boarded";

interface HouseLook {
  readonly siding: string;
  readonly roof: string;
  readonly window: WindowState;
  readonly moss: number; // moss patches drawn on the shaded (left) wall, 0-3
  readonly patch: boolean; // a bare, missing-siding patch on the lit (right) wall
  readonly doorSkew: number; // px the door leans open, broken-down only
}

const LOOK: Readonly<Record<HealthBand, HouseLook>> = {
  immaculate: { siding: "#e4ddc9", roof: "#7d8a8f", window: "clear", moss: 0, patch: false, doorSkew: 0 },
  dusty: { siding: "#d7cfb8", roof: "#8a8474", window: "hazy", moss: 0, patch: false, doorSkew: 0 },
  grubby: { siding: "#b7a988", roof: "#726b54", window: "hazy", moss: 1, patch: false, doorSkew: 0 },
  damaged: { siding: "#a08f6c", roof: "#5f5a45", window: "cracked", moss: 2, patch: true, doorSkew: 0 },
  "broken-down": { siding: "#847357", roof: "#4a4536", window: "boarded", moss: 3, patch: true, doorSkew: 7 },
};

/**
 * The house: a flat-roofed box on the shared grid. Only the top face (roof) and the
 * two walls facing the camera are drawn — the far walls and the flat attic under the
 * roof are never visible from this camera angle, same as every other object here.
 */
export function House({ band }: HouseProps) {
  const look = LOOK[normalizeBand(band)];

  const A = isoToScreen(HOUSE_FOOTPRINT.gx0, HOUSE_FOOTPRINT.gy0); // back corner
  const B = isoToScreen(HOUSE_FOOTPRINT.gx1, HOUSE_FOOTPRINT.gy0); // right corner
  const C = isoToScreen(HOUSE_FOOTPRINT.gx1, HOUSE_FOOTPRINT.gy1); // front corner (closest to camera)
  const D = isoToScreen(HOUSE_FOOTPRINT.gx0, HOUSE_FOOTPRINT.gy1); // left corner
  const A2 = up(A, HOUSE_LIFT);
  const B2 = up(B, HOUSE_LIFT);
  const C2 = up(C, HOUSE_LIFT);
  const D2 = up(D, HOUSE_LIFT);

  // Right wall (B→C): faces away from the sun, darkest. Left wall (D→C): faces the sun, mid.
  const rightWall: [Pt, Pt, Pt, Pt] = [B, C, B2, C2];
  const leftWall: [Pt, Pt, Pt, Pt] = [D, C, D2, C2];

  const windowQuad = insetQuad(rightWall[0], rightWall[1], rightWall[2], rightWall[3], 0.15, 0.55, 0.4, 0.78);
  const doorQuad = insetQuad(leftWall[0], leftWall[1], leftWall[2], leftWall[3], 0.55, 0.82, 0, 0.55).map((p, i) =>
    // The door leans open on broken-down: the top two corners (index 1, 2) shift sideways.
    i === 1 || i === 2 ? { x: p.x + look.doorSkew, y: p.y } : p,
  );

  const mossSpots = Array.from({ length: look.moss }, (_, i) =>
    insetQuad(leftWall[0], leftWall[1], leftWall[2], leftWall[3], 0.08 + i * 0.14, 0.16 + i * 0.14, 0.05, 0.16),
  );

  return (
    <g data-art="house">
      {/* Roof / top face */}
      <polygon points={poly([A2, B2, C2, D2])} fill={shade(look.roof, "top")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />

      {/* Walls */}
      <polygon points={poly([B, C, C2, B2])} fill={shade(look.siding, "dark")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
      <polygon points={poly([D, C, C2, D2])} fill={shade(look.siding, "mid")} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />

      {/* Bare-siding patch, damaged and broken-down only */}
      {look.patch && (
        <polygon
          points={poly(insetQuad(rightWall[0], rightWall[1], rightWall[2], rightWall[3], 0.62, 0.88, 0.05, 0.3))}
          fill="#5c5240"
        />
      )}

      {/* Moss climbing the shaded wall, grubby and worse */}
      {mossSpots.map((spot, i) => (
        <polygon key={i} points={poly(spot)} fill="#3d4a34" />
      ))}

      {/* Window */}
      {look.window === "boarded" ? (
        <>
          <polygon points={poly(windowQuad)} fill="#5a4630" />
          <line x1={windowQuad[0].x} y1={windowQuad[0].y} x2={windowQuad[2].x} y2={windowQuad[2].y} stroke="#3c2f1f" strokeWidth={2} />
          <line x1={windowQuad[1].x} y1={windowQuad[1].y} x2={windowQuad[3].x} y2={windowQuad[3].y} stroke="#3c2f1f" strokeWidth={2} />
        </>
      ) : (
        <>
          <polygon
            points={poly(windowQuad)}
            fill={look.window === "clear" ? "#bfe3f2" : "#8f9c9c"}
            stroke="rgba(0,0,0,0.25)"
            strokeWidth={1}
          />
          {look.window === "clear" && (
            <polygon
              points={poly([
                lerp(windowQuad[0], windowQuad[1], 0.55),
                lerp(windowQuad[0], windowQuad[1], 0.85),
                lerp(windowQuad[3], windowQuad[2], 0.85),
                lerp(windowQuad[3], windowQuad[2], 0.55),
              ])}
              fill="#eaf6fb"
            />
          )}
          {look.window === "cracked" && (
            <polyline
              points={poly([windowQuad[0], lerp(windowQuad[0], windowQuad[2], 0.4), lerp(windowQuad[1], windowQuad[3], 0.5), windowQuad[3]])}
              fill="none"
              stroke="#2b2b2b"
              strokeWidth={1.5}
            />
          )}
        </>
      )}

      {/* Door */}
      <polygon points={poly(doorQuad)} fill={shade("#2f4f3a", "mid")} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
    </g>
  );
}
