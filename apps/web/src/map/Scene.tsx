import { useEffect, useRef, useSyncExternalStore } from "react";
import type { MapPresenter } from "../presenters/MapPresenter.js";
import type { CameraState } from "./Camera.js";
import { usePointerGestures } from "./usePointerGestures.js";
import { Ground } from "../art/Ground.js";
import { House } from "../art/House.js";
import { Garden } from "../art/Garden.js";
import { Car } from "../art/Car.js";
import { Character } from "../art/Character.js";
import {
  CAR_FOOTPRINT,
  CAR_LIFT,
  GARDEN_FOOTPRINT,
  GARDEN_LIFT,
  HOUSE_FOOTPRINT,
  HOUSE_LIFT,
  isoToScreen,
} from "../art/layout.js";
import { poly, up, type Pt } from "../art/geometry.js";

/**
 * The scene graph shape is fixed by the map contract (section 2) and is not
 * negotiable: one inline `<svg>`, one root `<g data-testid="camera">` carrying the
 * whole transform, and the two character overlays as *siblings* of the `<svg>` —
 * outside the camera transform entirely, so panning or zooming the map never moves
 * them. That is the single most important structural rule here: parent a character
 * into the camera and the fairness signal it carries slides off-screen exactly when
 * someone is exploring the map, at the moment it is most wanted.
 */

const ASSET_ORDER = ["house", "garden", "car"] as const;

function renderAssetArt(kind: string, band: string) {
  if (kind === "house") return <House band={band} />;
  if (kind === "garden") return <Garden band={band} />;
  if (kind === "car") return <Car band={band} />;
  return null;
}

/**
 * The visible silhouette of an isometric box — a hexagon: back-top, right-top,
 * right-bottom, front-bottom, left-bottom, left-top. Used as each asset's explicit hit
 * target (contract's "give each asset group an explicit hit target") rather than its
 * axis-aligned bounding box: the house, garden and car's *boxes* overlap on screen
 * (the isometric footprints are staggered, not laid out in a row), but their actual
 * drawn shapes do not, so a hex sized to the real silhouette is what makes a click on
 * one asset never register on its neighbour.
 */
function hitSilhouette(
  footprint: { gx0: number; gy0: number; gx1: number; gy1: number },
  lift: number,
  groundDrop = 0,
): string {
  const A = isoToScreen(footprint.gx0, footprint.gy0);
  const B = up(isoToScreen(footprint.gx1, footprint.gy0), -groundDrop);
  const C = up(isoToScreen(footprint.gx1, footprint.gy1), -groundDrop);
  const D = up(isoToScreen(footprint.gx0, footprint.gy1), -groundDrop);
  const A2 = up(A, lift);
  const B2 = up(B, lift);
  const D2 = up(D, lift);
  const hex: readonly Pt[] = [A2, B2, B, C, D, D2];
  return poly(hex);
}

/**
 * A few details deliberately sit BELOW their object's footprint line, where the ground
 * would otherwise cut them off: the house's doorstep and the car's wheels, both of which
 * overhang by about 7.5px. The hexagon above is built from footprint corners, so without
 * this it stops short of them and leaves a thin dead strip along the front of two of the
 * three objects. 8px covers both with a little to spare.
 *
 * The artwork itself is filled and clickable, so a tap landing directly on a wheel
 * already selects the car by bubbling; this is only about the small empty margin just
 * past those corners. The garden's tree fits inside its hexagon already and needs none.
 */
const GROUND_OVERHANG_PX = 8;

const HIT_SILHOUETTES: Readonly<Record<string, string>> = {
  house: hitSilhouette(HOUSE_FOOTPRINT, HOUSE_LIFT, GROUND_OVERHANG_PX),
  garden: hitSilhouette(GARDEN_FOOTPRINT, GARDEN_LIFT),
  car: hitSilhouette(CAR_FOOTPRINT, CAR_LIFT, GROUND_OVERHANG_PX),
};

/**
 * `translate(TX, TY) scale(S)`, exactly — `e2e/map.spec.ts` parses this string with a
 * fixed regex and also reads `data-scale` as a plain string (`"3"`, `"1"`), so both
 * numbers are rounded before they are ever turned into text: without that, a clamp
 * that lands on `MAX_SCALE` as `2.9999999999999996` (a real float artifact of
 * `Math.min`/`Math.max` composed through `zoomTo` then `clamp`) would fail the exact
 * `"3"` comparison, and the same camera state could serialise to a different string
 * from one render to the next.
 */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function formatCamera(camera: CameraState): { transform: string; scale: string } {
  const tx = round(camera.tx);
  const ty = round(camera.ty);
  const scale = round(camera.scale);
  return { transform: `translate(${tx}, ${ty}) scale(${scale})`, scale: String(scale) };
}

export interface SceneProps {
  readonly map: MapPresenter;
  readonly onSelectAsset: (assetId: string) => void;
  readonly onSelectPerson: (personId: string) => void;
  readonly onNavChores: () => void;
  readonly onNavStats: () => void;
  readonly onAddChore: () => void;
}

export function Scene({ map, onSelectAsset, onSelectPerson, onNavChores, onNavStats, onAddChore }: SceneProps) {
  const state = useSyncExternalStore(map.subscribe, map.snapshot);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gestures = usePointerGestures(map, svgRef);

  // The view measures its own viewport and hands the rect to the presenter — Camera.ts
  // and MapPresenter never touch the DOM themselves.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;

    function measure() {
      if (svg === null) return;
      const rect = svg.getBoundingClientRect();
      map.setViewport({ x: 0, y: 0, w: rect.width, h: rect.height });
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [map]);

  const { transform, scale } = formatCamera(state.camera);

  return (
    <section className="map-screen" data-testid="map-screen">
      <svg ref={svgRef} className="map-svg" data-testid="map-svg">
        <g
          data-testid="camera"
          data-scale={scale}
          transform={transform}
          className={gestures.isPointerActive ? "map-camera map-camera-static" : "map-camera"}
        >
          <Ground />
          {ASSET_ORDER.map((kind) => {
            const asset = state.assets.find((a) => a.kind === kind);
            if (asset === undefined) return null;
            return (
              <g
                key={asset.id}
                data-testid="map-asset"
                data-asset-id={asset.id}
                data-band={asset.band}
                tabIndex={0}
                role="button"
                aria-label={`${asset.label}, ${asset.band}${asset.overdueCount > 0 ? `, ${asset.overdueCount} overdue` : ""}`}
                onClick={() => {
                  onSelectAsset(asset.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectAsset(asset.id);
                  }
                }}
              >
                {/* Explicit hit target: the object's own silhouette, not its bbox —
                    see hitSilhouette's comment above. */}
                <polygon points={HIT_SILHOUETTES[asset.kind] ?? ""} fill="#000" fillOpacity={0} pointerEvents="all" />
                {renderAssetArt(asset.kind, asset.band)}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Outside the <svg> entirely: fixed overlays, never touched by the camera transform. */}
      {state.characters.map((character, i) => (
        <button
          key={character.id}
          type="button"
          className={`map-character ${i % 2 === 0 ? "map-character-left" : "map-character-right"}`}
          data-testid="map-character"
          data-person-id={character.id}
          data-tier={character.tier}
          aria-label={`${character.displayName}, ${character.sharePct}% of the fair share`}
          onClick={() => {
            onSelectPerson(character.id);
          }}
        >
          <Character tier={character.tier} />
        </button>
      ))}

      <div className="map-zoom-controls">
        <button
          type="button"
          data-testid="zoom-in"
          aria-label="Zoom in"
          onClick={() => {
            map.zoomBy(1.25);
          }}
        >
          +
        </button>
        <button
          type="button"
          data-testid="zoom-out"
          aria-label="Zoom out"
          onClick={() => {
            map.zoomBy(0.8);
          }}
        >
          &minus;
        </button>
      </div>

      <nav className="map-toolbar" aria-label="Primary">
        <button type="button" data-testid="nav-chores" onClick={onNavChores}>
          Chores
        </button>
        <button type="button" data-testid="nav-stats" onClick={onNavStats}>
          Stats
        </button>
        <button type="button" data-testid="nav-add" onClick={onAddChore}>
          Add chore
        </button>
      </nav>
    </section>
  );
}
