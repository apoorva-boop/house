import { CAR_FOOTPRINT, CAR_LIFT, isoToScreen, shade } from "./layout.js";
import { groundPatch, insetQuad, lerp, poly, up, normalizeBand } from "./geometry.js";
import type { HealthBand, Pt } from "./geometry.js";

export interface CarProps {
  readonly band: string;
}

type WindowState = "clear" | "hazy" | "cracked" | "shattered";

interface CarLook {
  readonly body: string;
  readonly rust: number; // rust patches scattered over both walls, 0-5
  readonly window: WindowState;
  readonly dent: boolean; // a dark dent notch on the lit side
  readonly sag: number; // px the cabin height is lost to a sagging suspension
}

const LOOK: Readonly<Record<HealthBand, CarLook>> = {
  immaculate: { body: "#3a6ea5", rust: 0, window: "clear", dent: false, sag: 0 },
  dusty: { body: "#3f6690", rust: 0, window: "hazy", dent: false, sag: 0 },
  grubby: { body: "#4a5f78", rust: 1, window: "hazy", dent: false, sag: 2 },
  damaged: { body: "#57584f", rust: 3, window: "cracked", dent: true, sag: 5 },
  "broken-down": { body: "#4b453d", rust: 5, window: "shattered", dent: true, sag: 10 },
};

/** Fixed (u, v) slots on a wall face for rust patches, so the count grows in a stable order. */
const RUST_SLOTS: readonly [number, number][] = [
  [0.15, 0.1],
  [0.7, 0.15],
  [0.4, 0.75],
  [0.85, 0.7],
  [0.2, 0.55],
];

/**
 * The car: a small box on the shared grid, same top/mid/dark language as House and
 * Garden. `sag` lets the cabin sit visibly lower as the band worsens without ever
 * exceeding CAR_LIFT — the box only ever gets shorter, so it never escapes
 * `ASSET_RECTS.car`.
 */
export function Car({ band }: CarProps) {
  const look = LOOK[normalizeBand(band)];
  const lift = CAR_LIFT - look.sag;

  const A = isoToScreen(CAR_FOOTPRINT.gx0, CAR_FOOTPRINT.gy0);
  const B = isoToScreen(CAR_FOOTPRINT.gx1, CAR_FOOTPRINT.gy0);
  const C = isoToScreen(CAR_FOOTPRINT.gx1, CAR_FOOTPRINT.gy1);
  const D = isoToScreen(CAR_FOOTPRINT.gx0, CAR_FOOTPRINT.gy1);
  const A2 = up(A, lift);
  const B2 = up(B, lift);
  const C2 = up(C, lift);
  const D2 = up(D, lift);

  const rightWall: [Pt, Pt, Pt, Pt] = [B, C, B2, C2];
  const leftWall: [Pt, Pt, Pt, Pt] = [D, C, D2, C2];

  const rightWindow = insetQuad(rightWall[0], rightWall[1], rightWall[2], rightWall[3], 0.2, 0.75, 0.4, 0.85);
  const leftWindow = insetQuad(leftWall[0], leftWall[1], leftWall[2], leftWall[3], 0.2, 0.75, 0.4, 0.85);

  const rustOn = (wall: [Pt, Pt, Pt, Pt], count: number) =>
    RUST_SLOTS.slice(0, count).map(([u, v]) => insetQuad(wall[0], wall[1], wall[2], wall[3], u, u + 0.12, v, v + 0.12));

  const windowFill = look.window === "clear" ? "#dff0f7" : look.window === "hazy" ? "#9fb2b5" : "#7c8a8c";

  return (
    <g data-art="car">
      {/* Wheels, centred on the ground edge so half peeks out from under the body drawn over them */}
      <polygon
        points={poly(groundPatch(isoToScreen, CAR_FOOTPRINT.gx1, CAR_FOOTPRINT.gy0 + 0.25 * (CAR_FOOTPRINT.gy1 - CAR_FOOTPRINT.gy0), 0.18))}
        fill="#1c1c1c"
      />
      <polygon
        points={poly(groundPatch(isoToScreen, CAR_FOOTPRINT.gx1, CAR_FOOTPRINT.gy0 + 0.75 * (CAR_FOOTPRINT.gy1 - CAR_FOOTPRINT.gy0), 0.18))}
        fill="#1c1c1c"
      />

      {/* Cabin roof */}
      <polygon points={poly([A2, B2, C2, D2])} fill={shade(look.body, "top")} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />

      {/* Body sides */}
      <polygon points={poly([B, C, C2, B2])} fill={shade(look.body, "dark")} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />
      <polygon points={poly([D, C, C2, D2])} fill={shade(look.body, "mid")} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />

      {/* Dent, damaged and worse */}
      {look.dent && (
        <polygon points={poly(insetQuad(leftWall[0], leftWall[1], leftWall[2], leftWall[3], 0.35, 0.55, 0.15, 0.35))} fill="#2f3a2f" />
      )}

      {/* Rust */}
      {rustOn(rightWall, Math.min(look.rust, 3)).map((spot, i) => (
        <polygon key={`rr-${i}`} points={poly(spot)} fill="#7a3f22" />
      ))}
      {rustOn(leftWall, Math.max(0, look.rust - 3)).map((spot, i) => (
        <polygon key={`lr-${i}`} points={poly(spot)} fill="#7a3f22" />
      ))}

      {/* Windows */}
      <polygon points={poly(rightWindow)} fill={windowFill} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
      <polygon points={poly(leftWindow)} fill={windowFill} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />

      {(look.window === "cracked" || look.window === "shattered") && (
        <polyline
          points={poly([
            rightWindow[0],
            lerp(rightWindow[0], rightWindow[2], 0.5),
            lerp(rightWindow[1], rightWindow[3], 0.5),
            rightWindow[3],
          ])}
          fill="none"
          stroke="#20201f"
          strokeWidth={1.5}
        />
      )}
      {look.window === "shattered" && (
        <polyline
          points={poly([leftWindow[1], lerp(leftWindow[0], leftWindow[2], 0.5), leftWindow[3]])}
          fill="none"
          stroke="#20201f"
          strokeWidth={1.5}
        />
      )}
    </g>
  );
}
