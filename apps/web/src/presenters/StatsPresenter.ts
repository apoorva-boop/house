// STUB - phase 3. Seeded with fake people, assets and a fake recent completion so the
// stats screen renders something on first load. `proposeReset`/`approveReset`/
// `declineReset` are no-ops, so the reset state stays "none" forever: flow 27 can click
// through propose-then-approve and will correctly fail on "tiers changed after
// approval", because they never do.
import { Presenter } from "../app/Presenter.js";
import type { Clock } from "../app/ctx.js";
import type { Gateway } from "../gateway/SheetsGateway.js";
import type { MutationQueue } from "../offline/MutationQueue.js";

export interface PersonStatsVM {
  readonly id: string;
  readonly displayName: string;
  readonly isYou: boolean;
  readonly points: number;
  readonly sharePct: number;
  readonly tier: number;
  readonly completions: number;
}

export interface AssetStatsVM {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly points: number;
  readonly completions: number;
  readonly health: number;
  readonly band: string;
}

export interface RecentCompletionVM {
  readonly mutationId: string;
  readonly choreTitle: string;
  readonly assetLabel: string;
  readonly personName: string;
  readonly points: number;
  readonly whenLabel: string;
}

export interface ResetVM {
  readonly state: string;
  readonly proposedByName: string | null;
  readonly canPropose: boolean;
  readonly canApprove: boolean;
  readonly canDecline: boolean;
}

export interface StatsViewState {
  readonly status: "loading" | "ready" | "error";
  readonly error: string | null;
  readonly windowPoints: number;
  readonly people: readonly PersonStatsVM[];
  readonly assets: readonly AssetStatsVM[];
  readonly recent: readonly RecentCompletionVM[];
  readonly reset: ResetVM;
}

export interface StatsPresenterDeps {
  readonly gateway: Gateway;
  readonly queue: MutationQueue;
  readonly now: Clock;
  readonly timeZone: string;
  readonly personId: string;
  readonly store: Storage;
}

const STUB_PEOPLE: PersonStatsVM[] = [
  { id: "stub-person-1", displayName: "Stub person one", isYou: false, points: NaN, sharePct: NaN, tier: NaN, completions: NaN },
  { id: "stub-person-2", displayName: "Stub person two", isYou: false, points: NaN, sharePct: NaN, tier: NaN, completions: NaN },
];

const STUB_ASSETS: AssetStatsVM[] = [
  { id: "stub-asset-house", kind: "house", label: "House", points: NaN, completions: NaN, health: NaN, band: "stub" },
  { id: "stub-asset-garden", kind: "garden", label: "Garden", points: NaN, completions: NaN, health: NaN, band: "stub" },
  { id: "stub-asset-car", kind: "car", label: "Car", points: NaN, completions: NaN, health: NaN, band: "stub" },
];

const STUB_RECENT: RecentCompletionVM[] = [
  {
    mutationId: "stub-mutation-1",
    choreTitle: "Stub chore one",
    assetLabel: "House",
    personName: "Stub person one",
    points: NaN,
    whenLabel: "stub",
  },
];

// Nobody has proposed a reset yet — the accurate starting state, not a faked one.
const STUB_RESET: ResetVM = {
  state: "none",
  proposedByName: null,
  canPropose: true,
  canApprove: false,
  canDecline: false,
};

export class StatsPresenter extends Presenter<StatsViewState> {
  readonly #deps: StatsPresenterDeps;

  constructor(deps: StatsPresenterDeps) {
    super({
      status: "ready",
      error: null,
      windowPoints: NaN,
      people: STUB_PEOPLE,
      assets: STUB_ASSETS,
      recent: STUB_RECENT,
      reset: STUB_RESET,
    });
    this.#deps = deps;
  }

  /** Not wired up yet. */
  async load(): Promise<void> {
    void this.#deps.gateway;
    void this.#deps.queue;
    void this.#deps.now;
    void this.#deps.timeZone;
    void this.#deps.personId;
  }

  /** Reset is `localStorage` under `house.reset`. Not wired up yet. */
  proposeReset(): void {
    void this.#deps.store;
  }

  approveReset(): void {}

  declineReset(): void {}
}
