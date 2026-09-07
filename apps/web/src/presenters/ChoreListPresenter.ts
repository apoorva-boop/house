// STUB - phase 3. Seeded with two fake chore rows and three fake assets carrying
// sentinel values so the list, the tick button and the asset health readouts all exist
// in the DOM from the first render. Every method that should mutate state (`tick`,
// `seedDefaults`, `saveDraft`, `deleteChore`, `retrySync`) is a no-op: a test can find
// `chore-tick`, click it, and then fail because nothing happened, not because the
// button does not exist.
import { Presenter } from "../app/Presenter.js";
import type { Clock } from "../app/ctx.js";
import type { Gateway } from "../gateway/SheetsGateway.js";
import type { MutationQueue } from "../offline/MutationQueue.js";

export type ChoreRowState = "overdue" | "due" | "scheduled" | "unscheduled";

export interface ChoreRowVM {
  readonly id: string;
  readonly title: string;
  readonly assetId: string;
  readonly assetLabel: string;
  readonly points: number;
  readonly state: ChoreRowState;
  readonly overdueDays: number;
  readonly dueLabel: string;
  readonly pending: boolean;
  readonly canTick: boolean;
}

export interface AssetVM {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly health: number;
  readonly band: string;
  readonly overdueCount: number;
}

export interface RescueVM {
  readonly overdueCount: number;
  readonly recommendedChoreId: string | null;
  readonly recommendedTitle: string | null;
  readonly bonusPoints: number;
}

export interface ChoreDraft {
  readonly id: string | null;
  readonly title: string;
  readonly assetId: string;
  readonly time: number;
  readonly effort: number;
  readonly priority: number;
  readonly recurrenceUnit: string;
  readonly recurrenceN: number;
  readonly deadlineDate: string;
  readonly leadTimeDays: number | null;
}

export interface ChoreListViewState {
  readonly status: "loading" | "ready" | "error";
  readonly error: string | null;
  readonly rows: readonly ChoreRowVM[];
  readonly assets: readonly AssetVM[];
  readonly rescue: RescueVM | null;
  readonly isEmpty: boolean;
  readonly queueSize: number;
  readonly syncError: string | null;
  readonly editing: ChoreDraft | null;
  readonly editingPoints: number;
  readonly busy: boolean;
}

export interface ChoreListPresenterDeps {
  readonly gateway: Gateway;
  readonly queue: MutationQueue;
  readonly now: Clock;
  readonly timeZone: string;
  readonly personId: string;
  readonly newId: () => string;
}

const STUB_ASSETS: AssetVM[] = [
  { id: "stub-asset-house", kind: "house", label: "House", health: NaN, band: "stub", overdueCount: NaN },
  { id: "stub-asset-garden", kind: "garden", label: "Garden", health: NaN, band: "stub", overdueCount: NaN },
  { id: "stub-asset-car", kind: "car", label: "Car", health: NaN, band: "stub", overdueCount: NaN },
];

const STUB_ROWS: ChoreRowVM[] = [
  {
    id: "stub-chore-1",
    title: "Stub chore one",
    assetId: "stub-asset-house",
    assetLabel: "House",
    points: NaN,
    state: "stub" as unknown as ChoreRowState,
    overdueDays: NaN,
    dueLabel: "stub",
    pending: false,
    canTick: true,
  },
  {
    id: "stub-chore-2",
    title: "Stub chore two",
    assetId: "stub-asset-garden",
    assetLabel: "Garden",
    points: NaN,
    state: "stub" as unknown as ChoreRowState,
    overdueDays: NaN,
    dueLabel: "stub",
    pending: false,
    canTick: true,
  },
];

const EMPTY_DRAFT: ChoreDraft = {
  id: null,
  title: "",
  assetId: STUB_ASSETS[0]!.id,
  time: 1,
  effort: 1,
  priority: 1,
  recurrenceUnit: "",
  recurrenceN: 0,
  deadlineDate: "",
  leadTimeDays: null,
};

export class ChoreListPresenter extends Presenter<ChoreListViewState> {
  readonly #deps: ChoreListPresenterDeps;

  constructor(deps: ChoreListPresenterDeps) {
    super({
      status: "ready",
      error: null,
      rows: STUB_ROWS,
      assets: STUB_ASSETS,
      rescue: null,
      isEmpty: false,
      queueSize: NaN,
      syncError: null,
      editing: null,
      editingPoints: NaN,
      busy: false,
    });
    this.#deps = deps;
  }

  /** snapshot -> applyPending -> setState. Not wired up yet. */
  async load(): Promise<void> {
    void this.#deps.gateway;
  }

  /** Same as `load`, used to prove flow 47. Not wired up yet. */
  async refresh(): Promise<void> {}

  async tick(choreId: string): Promise<void> {
    void choreId;
    void this.#deps.queue;
    void this.#deps.now;
    void this.#deps.timeZone;
    void this.#deps.personId;
    void this.#deps.newId;
  }

  async seedDefaults(): Promise<void> {}

  startCreate(): void {
    this.setState({ ...this.state, editing: EMPTY_DRAFT, editingPoints: NaN });
  }

  startEdit(choreId: string): void {
    const row = this.state.rows.find((r) => r.id === choreId);
    this.setState({
      ...this.state,
      editing: {
        id: choreId,
        title: row?.title ?? "stub",
        assetId: row?.assetId ?? STUB_ASSETS[0]!.id,
        time: 1,
        effort: 1,
        priority: 1,
        recurrenceUnit: "",
        recurrenceN: 0,
        deadlineDate: "",
        leadTimeDays: null,
      },
      editingPoints: NaN,
    });
  }

  changeDraft(patch: Partial<ChoreDraft>): void {
    if (this.state.editing === null) return;
    this.setState({ ...this.state, editing: { ...this.state.editing, ...patch } });
  }

  cancelEdit(): void {
    this.setState({ ...this.state, editing: null, editingPoints: NaN });
  }

  async saveDraft(): Promise<void> {}

  async deleteChore(choreId: string): Promise<void> {
    void choreId;
  }

  async retrySync(): Promise<void> {}
}
