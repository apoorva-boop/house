import { CAR_FOOTPRINT, CAR_LIFT, isoToScreen } from "./layout.js";
import { shade, tone } from "./ArtTokens.js";
import { insetQuad, lerp, poly, up, normalizeBand } from "./geometry.js";
import type { HealthBand, Pt } from "./geometry.js";

export interface CarProps {
  readonly band: string;
}

type WindowState = "clear" | "hazy" | "cracked" | "shattered";

interface CarLook {
  readonly body: string; // ArtTokens role name
  readonly rust: number; // rust patches scattered over both walls, 0-5
  readonly window: WindowState;
  readonly dent: boolean; // a dark dent notch on the lit side
  readonly sag: number; // px the cabin height is lost to a sagging suspension
}

const LOOK: Readonly<Record<HealthBand, CarLook>> = {
  immaculate: { body: "car-body-immaculate", rust: 0, window: "clear", dent: false, sag: 0 },
  dusty: { body: "car-body-dusty", rust: 0, window: "hazy", dent: false, sag: 0 },
  grubby: { body: "car-body-grubby", rust: 1, window: "hazy", dent: false, sag: 2 },
  damaged: { body: "car-body-damaged", rust: 3, window: "cracked", dent: true, sag: 5 },
  "broken-down": { body: "car-body-broken-down", rust: 5, window: "shattered", dent: true, sag: 10 },
};

/** Fixed (u, v) slots on a wall face for rust patches, so the count grows in a stable order. */
const RUST_SLOTS: readonly [number, number][] = [
  [0.15, 0.1],
  [0.7, 0.15],
  [0.4, 0.7],
  [0.2, 0.55],
  [0.6, 0.6],
];

/**
 * The car: a cabin over a lower bonnet, on the shared grid, same top/mid/dark
 * language as House and Garden. Splitting the box into two heights along its depth
 * (`gyMid`) is what gives it a windscreen (the wall between them), a bonnet lower than
 * the cabin, and a stepped side silhouette instead of one flat-topped block. `sag`
 * lowers both heights together as the band worsens without ever exceeding `CAR_LIFT` —
 * the cabin only ever gets shorter, so it never escapes `ASSET_RECTS.car`.
 */
export function Car({ band }: CarProps) {
  const look = LOOK[normalizeBand(band)];
  const cabinLift = CAR_LIFT - look.sag;
  const bonnetLift = cabinLift * 0.5;

  const { gx0, gy0, gx1, gy1 } = CAR_FOOTPRINT;
  const gyMid = (gy0 + gy1) / 2;

  // Ground-plane corners (lift 0).
  const gB = isoToScreen(gx1, gy0); // back-right (cabin side, far end)
  const gMx1 = isoToScreen(gx1, gyMid); // mid-right (cabin/bonnet side seam)
  const gC = isoToScreen(gx1, gy1); // front-right (bonnet side, near end)
  const gMx0 = isoToScreen(gx0, gyMid); // mid-left (windscreen base, far side)
  const gD = isoToScreen(gx0, gy1); // front-left (bonnet front, far side)

  // Cabin-height points.
  const B2 = up(gB, cabinLift);
  const Mx1c = up(gMx1, cabinLift);
  const Mx0c = up(gMx0, cabinLift);
  const cabinRoofBack = up(isoToScreen(gx0, gy0), cabinLift);

  // Bonnet-height points.
  const Mx1b = up(gMx1, bonnetLift);
  const Mx0b = up(gMx0, bonnetLift);
  const Cb = up(gC, bonnetLift);
  const Db = up(gD, bonnetLift);

  // Each wall tuple is `[bottomA, bottomB, topA, topB]` — `insetQuad`'s basis, with
  // `topA`/`topB` each directly above the matching bottom corner (matching House.tsx's
  // convention) — so a *separate* perimeter-ordered array is used wherever one of
  // these needs to be filled as a `<polygon>` directly.
  const cabinSideWall: [Pt, Pt, Pt, Pt] = [gB, gMx1, B2, Mx1c];
  const bonnetSideWall: [Pt, Pt, Pt, Pt] = [gMx1, gC, Mx1b, Cb];
  const bonnetFrontWall: [Pt, Pt, Pt, Pt] = [gD, gC, Db, Cb];
  const windscreenWall: [Pt, Pt, Pt, Pt] = [Mx0b, Mx1b, Mx0c, Mx1c];

  const sideWindow = insetQuad(cabinSideWall[0], cabinSideWall[1], cabinSideWall[2], cabinSideWall[3], 0.18, 0.82, 0.35, 0.85);
  const windscreen = insetQuad(windscreenWall[0], windscreenWall[1], windscreenWall[2], windscreenWall[3], 0.12, 0.88, 0.15, 0.9);

  const glassRole =
    look.window === "clear"
      ? "car-window-clear"
      : look.window === "hazy"
        ? "car-window-hazy"
        : "car-window-dirty"; // cracked and shattered share the dirtier tint, distinguished by the crack lines drawn over it

  const rustSpots = (wall: [Pt, Pt, Pt, Pt], count: number) =>
    RUST_SLOTS.slice(0, count).map(([u, v]) => insetQuad(wall[0], wall[1], wall[2], wall[3], u, u + 0.12, v, v + 0.12));

  // Wheels: drawn last (on top of the body), each a small dark quad that overhangs the
  // bottom edge of its wall by more than it sits above it — the previous pass drew
  // wheels first and the body painted straight over them, which is why they never
  // showed up at all.
  const wheel = (wall: [Pt, Pt, Pt, Pt]) => {
    // Wider than it is tall -- a wheel peeking out from under the body reads as a
    // squat shape, not a vertical slat -- and `u` stays clear of `bottomB` (the wall's
    // forward corner, already the footprint's own lowest/frontmost point) so the
    // overhang below `v=0` never pushes past `ASSET_RECTS.car`'s bottom edge on the
    // bonnet wall's shorter, closer-to-the-edge geometry.
    const tire = insetQuad(wall[0], wall[1], wall[2], wall[3], 0.08, 0.6, -0.22, 0.05);
    const hub = insetQuad(wall[0], wall[1], wall[2], wall[3], 0.24, 0.44, -0.15, -0.03);
    return (
      <>
        <polygon points={poly(tire)} fill={tone("car-wheel")} />
        <polygon points={poly(hub)} fill={tone("car-hubcap")} />
      </>
    );
  };

  return (
    <g data-art="car">
      {/* Cabin roof */}
      <polygon points={poly([cabinRoofBack, B2, Mx1c, Mx0c])} fill={shade(look.body, "top")} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />

      {/* Cabin side wall */}
      <polygon points={poly([gB, gMx1, Mx1c, B2])} fill={shade(look.body, "dark")} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />

      {/* Windscreen — the same glass family as the side window, but full-height and
          upright, so it reads as one continuous windscreen rather than another side
          window. */}
      <polygon points={poly([Mx0b, Mx1b, Mx1c, Mx0c])} fill={shade(look.body, "mid")} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />
      <polygon points={poly(windscreen)} fill={tone(glassRole)} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
      {look.window === "clear" && (
        <polygon
          points={poly([
            lerp(windscreen[0], windscreen[1], 0.1),
            lerp(windscreen[0], windscreen[1], 0.4),
            lerp(windscreen[3], windscreen[2], 0.4),
            lerp(windscreen[3], windscreen[2], 0.1),
          ])}
          fill={tone("car-window-highlight")}
        />
      )}

      {/* Bonnet: hood top, front fascia, and its own side panel — all lower than the cabin. */}
      <polygon points={poly([Mx0b, Mx1b, Cb, Db])} fill={shade(look.body, "top")} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />
      <polygon points={poly([gMx1, gC, Cb, Mx1b])} fill={shade(look.body, "dark")} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />
      <polygon points={poly([gD, gC, Cb, Db])} fill={shade(look.body, "mid")} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />

      {/* Dent, damaged and worse, on the bonnet's front fascia */}
      {look.dent && (
        <polygon
          points={poly(insetQuad(bonnetFrontWall[0], bonnetFrontWall[1], bonnetFrontWall[2], bonnetFrontWall[3], 0.35, 0.55, 0.15, 0.45))}
          fill={tone("car-dent")}
        />
      )}

      {/* Rust, spread across the cabin and bonnet side panels */}
      {rustSpots(cabinSideWall, Math.min(look.rust, 3)).map((spot, i) => (
        <polygon key={`cr-${i}`} points={poly(spot)} fill={tone("car-rust")} />
      ))}
      {rustSpots(bonnetSideWall, Math.max(0, look.rust - 3)).map((spot, i) => (
        <polygon key={`br-${i}`} points={poly(spot)} fill={tone("car-rust")} />
      ))}

      {/* Side window */}
      <polygon points={poly(sideWindow)} fill={tone(glassRole)} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />

      {(look.window === "cracked" || look.window === "shattered") && (
        <polyline
          points={poly([sideWindow[0], lerp(sideWindow[0], sideWindow[2], 0.5), lerp(sideWindow[1], sideWindow[3], 0.5), sideWindow[3]])}
          fill="none"
          stroke={tone("car-window-crack-line")}
          strokeWidth={1.5}
        />
      )}
      {look.window === "shattered" && (
        <polyline
          points={poly([windscreen[1], lerp(windscreen[0], windscreen[2], 0.5), windscreen[3]])}
          fill="none"
          stroke={tone("car-window-crack-line")}
          strokeWidth={1.5}
        />
      )}

      {/* Wheels: rear (under the cabin) and front (under the bonnet), drawn last so
          the body panels above never cover them. */}
      {wheel(cabinSideWall)}
      {wheel(bonnetSideWall)}
    </g>
  );
}
