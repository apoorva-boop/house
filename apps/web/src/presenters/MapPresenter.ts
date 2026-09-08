import { Presenter } from "../app/Presenter.js";
import { clamp, fit, zoomTo, MIN_SCALE, type CameraState, type Rect } from "../map/Camera.js";
import { ASSET_RECTS, SCENE_BOUNDS } from "../art/layout.js";
import type { AssetVM, ChoreListPresenter } from "./ChoreListPresenter.js";
import type { PersonStatsVM, StatsPresenter } from "./StatsPresenter.js";

export interface MapAssetVM {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly health: number;
  readonly band: string;
  readonly overdueCount: number;
}

export interface MapCharacterVM {
  readonly id: string;
  readonly displayName: string;
  readonly isYou: boolean;
  readonly tier: number;
  readonly points: number;
  readonly sharePct: number;
}

export interface MapViewState {
  readonly camera: CameraState;
  readonly assets: readonly MapAssetVM[];
  readonly characters: readonly MapCharacterVM[];
}

export interface MapPresenterDeps {
  readonly choreList: ChoreListPresenter;
  readonly stats: StatsPresenter;
}

/** Used only until the view's first real measurement arrives via `setViewport`. */
const PLACEHOLDER_VIEWPORT: Rect = { x: 0, y: 0, w: 375, h: 667 };

/**
 * Centres `SCENE_BOUNDS` in `viewport` at `MIN_SCALE`, then composes `clamp` — the
 * same "default camera" both the constructor and `resetCamera` use. `SCENE_BOUNDS` is
 * built (layout.ts) so its centre is exactly the centre of the three assets' own
 * bounding box, so this is also "frame the property", without needing `fit()`'s
 * scale-to-object behaviour (the default zoom is always `MIN_SCALE`, not whatever
 * scale happens to fit).
 */
function defaultCamera(viewport: Rect): CameraState {
  const cx = SCENE_BOUNDS.x + SCENE_BOUNDS.w / 2;
  const cy = SCENE_BOUNDS.y + SCENE_BOUNDS.h / 2;
  const raw: CameraState = {
    scale: MIN_SCALE,
    tx: viewport.x + viewport.w / 2 - cx * MIN_SCALE,
    ty: viewport.y + viewport.h / 2 - cy * MIN_SCALE,
  };
  return clamp(raw, SCENE_BOUNDS, viewport);
}

function toMapAsset(asset: AssetVM): MapAssetVM {
  return {
    id: asset.id,
    kind: asset.kind,
    label: asset.label,
    health: asset.health,
    band: asset.band,
    overdueCount: asset.overdueCount,
  };
}

function toMapCharacter(person: PersonStatsVM): MapCharacterVM {
  return {
    id: person.id,
    displayName: person.displayName,
    isYou: person.isYou,
    tier: person.tier,
    points: person.points,
    sharePct: person.sharePct,
  };
}

/**
 * Drives the map's camera and derives its two view lists from the two presenters that
 * have already computed them — `ChoreListPresenter`'s `assets` and `StatsPresenter`'s
 * `people` — rather than calling `@house/domain` a second time. A second computation
 * here would be a second answer that can disagree with the first (e.g. a health value
 * that drifts from what the chore list shows for the same asset).
 *
 * Every camera method is pure composition of `Camera.ts`'s `clamp`/`zoomTo`/`fit`; none
 * of them touch the DOM. The view measures its own viewport (in screen px) and hands
 * the rect in through `setViewport` — this class never reads `window` or a DOM node.
 */
export class MapPresenter extends Presenter<MapViewState> {
  readonly #deps: MapPresenterDeps;
  #viewport: Rect = PLACEHOLDER_VIEWPORT;

  constructor(deps: MapPresenterDeps) {
    super({
      camera: defaultCamera(PLACEHOLDER_VIEWPORT),
      assets: deps.choreList.state.assets.map(toMapAsset),
      characters: deps.stats.state.people.map(toMapCharacter),
    });
    this.#deps = deps;
    deps.choreList.subscribe(() => {
      this.#renderAssets();
    });
    deps.stats.subscribe(() => {
      this.#renderCharacters();
    });
  }

  /** The view measures its own `<svg>` and hands the rect in here — screen px, no viewBox rescale. */
  setViewport(viewport: Rect): void {
    const first = this.#viewport === PLACEHOLDER_VIEWPORT;
    this.#viewport = viewport;
    // On the very first real measurement there has been no user interaction yet, so
    // re-centre rather than merely clamping the placeholder-sized default — a 375x667
    // placeholder and the view's first real measurement are usually the same size, but
    // need not be (a wider phone, a resize before mount finishes).
    const camera = first ? defaultCamera(viewport) : clamp(this.state.camera, SCENE_BOUNDS, viewport);
    this.setState({ ...this.state, camera });
  }

  panBy(dx: number, dy: number): void {
    const moved: CameraState = { ...this.state.camera, tx: this.state.camera.tx + dx, ty: this.state.camera.ty + dy };
    this.setState({ ...this.state, camera: clamp(moved, SCENE_BOUNDS, this.#viewport) });
  }

  /** Zoom buttons: `factor` multiplies the current scale, focused on the viewport centre. */
  zoomBy(factor: number): void {
    const focus = { x: this.#viewport.x + this.#viewport.w / 2, y: this.#viewport.y + this.#viewport.h / 2 };
    this.zoomToScale(this.state.camera.scale * factor, focus);
  }

  /** Pinch: `scale` is absolute, `focus` is the pinch's screen-space midpoint. */
  zoomToScale(scale: number, focus: { x: number; y: number }): void {
    const zoomed = zoomTo(this.state.camera, scale, focus);
    this.setState({ ...this.state, camera: clamp(zoomed, SCENE_BOUNDS, this.#viewport) });
  }

  /** Double-tap: frames `assetId`'s scene-space rect (from `layout.ts`, no DOM measurement needed). */
  fitAsset(assetId: string): void {
    const rect = (ASSET_RECTS as Record<string, Rect | undefined>)[assetId];
    if (rect === undefined) return;
    const framed = fit(rect, this.#viewport);
    this.setState({ ...this.state, camera: clamp(framed, SCENE_BOUNDS, this.#viewport) });
  }

  resetCamera(): void {
    this.setState({ ...this.state, camera: defaultCamera(this.#viewport) });
  }

  #renderAssets(): void {
    this.setState({ ...this.state, assets: this.#deps.choreList.state.assets.map(toMapAsset) });
  }

  #renderCharacters(): void {
    this.setState({ ...this.state, characters: this.#deps.stats.state.people.map(toMapCharacter) });
  }
}
