import { Presenter } from "../app/Presenter.js";
import type { ChoreListPresenter } from "./ChoreListPresenter.js";

export interface AssetPanelChoreVM {
  readonly id: string;
  readonly title: string;
  readonly dueLabel: string;
  readonly pending: boolean;
}

export interface AssetPanelViewState {
  readonly open: boolean;
  readonly assetId: string | null;
  readonly label: string;
  readonly health: number;
  readonly band: string;
  readonly bandLabel: string;
  readonly chores: readonly AssetPanelChoreVM[];
}

export interface AssetPanelPresenterDeps {
  readonly choreList: ChoreListPresenter;
}

const EMPTY_STATE: AssetPanelViewState = {
  open: false,
  assetId: null,
  label: "",
  health: 0,
  band: "",
  bandLabel: "",
  chores: [],
};

/**
 * The plain-English word for a health band (Flow 59): `data-band` stays the raw
 * `HealthBand` string for tests and styling, but a person reads words, not a
 * hyphenated token. Falls back to the raw band so an unrecognised value is still
 * visible rather than blank.
 */
function describeBand(band: string): string {
  switch (band) {
    case "immaculate":
      return "immaculate";
    case "dusty":
      return "dusty";
    case "grubby":
      return "grubby";
    case "damaged":
      return "damaged";
    case "broken-down":
      return "broken down";
    default:
      return band;
  }
}

/**
 * Derives the asset panel entirely from `ChoreListPresenter`'s own state — never calls
 * `@house/domain` again. `chores` is only rows whose `state` is `"overdue"` and whose
 * `assetId` matches the open asset (map contract section 6); the health/band shown here
 * are the exact numbers `ChoreListPresenter` already computed for the map overlay, so
 * the two can never disagree about the same asset.
 */
export class AssetPanelPresenter extends Presenter<AssetPanelViewState> {
  readonly #deps: AssetPanelPresenterDeps;

  constructor(deps: AssetPanelPresenterDeps) {
    super(EMPTY_STATE);
    this.#deps = deps;
    // A tick (or any other change) re-renders the panel in place rather than closing it.
    deps.choreList.subscribe(() => {
      this.#refresh();
    });
  }

  open(assetId: string): void {
    const asset = this.#deps.choreList.state.assets.find((a) => a.id === assetId);
    if (asset === undefined) return;
    this.setState({
      open: true,
      assetId,
      label: asset.label,
      health: asset.health,
      band: asset.band,
      bandLabel: describeBand(asset.band),
      chores: this.#choresFor(assetId),
    });
  }

  close(): void {
    this.setState({ ...this.state, open: false });
  }

  async tick(choreId: string): Promise<void> {
    await this.#deps.choreList.tick(choreId);
  }

  #choresFor(assetId: string): readonly AssetPanelChoreVM[] {
    return this.#deps.choreList.state.rows
      .filter((row) => row.assetId === assetId && row.state === "overdue")
      .map((row) => ({ id: row.id, title: row.title, dueLabel: row.dueLabel, pending: row.pending }));
  }

  #refresh(): void {
    if (!this.state.open || this.state.assetId === null) return;
    const assetId = this.state.assetId;
    const asset = this.#deps.choreList.state.assets.find((a) => a.id === assetId);
    if (asset === undefined) return;
    this.setState({
      ...this.state,
      label: asset.label,
      health: asset.health,
      band: asset.band,
      bandLabel: describeBand(asset.band),
      chores: this.#choresFor(assetId),
    });
  }
}
