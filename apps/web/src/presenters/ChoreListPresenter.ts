import { Presenter } from "../app/Presenter.js";
import { makeCtx, type Clock } from "../app/ctx.js";
import type { Gateway } from "../gateway/SheetsGateway.js";
import type { MutationQueue } from "../offline/MutationQueue.js";
import { applyPending } from "../offline/reconcile.js";
import { EMPTY_HOUSEHOLD, effectiveDueAt, householdFromSnapshot, type Household } from "../model/Household.js";
import {
  weight,
  health,
  healthBand,
  isOverdue,
  hasReadableWeight,
  nextDueFrom,
  rescue as rescueRule,
  type Chore,
  type DomainCtx,
  type OverdueChore,
  type Recurrence,
  type RecurrenceUnit,
} from "@house/domain";

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

const MS_PER_DAY = 86_400_000;
const RECURRENCE_UNITS: ReadonlySet<string> = new Set<RecurrenceUnit>(["day", "week", "month", "year"]);

function labelForKind(kind: string): string {
  if (kind === "house") return "House";
  if (kind === "garden") return "Garden";
  if (kind === "car") return "Car";
  return kind.length > 0 ? kind[0]!.toUpperCase() + kind.slice(1) : kind;
}

/** yyyy-mm-dd in `timeZone`, so two instants can be compared as calendar days. */
function dayKey(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ts),
  );
}

/** Whole calendar days from `fromKey` to `toKey` (both `dayKey` strings). */
function calendarDaysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  const fromUtc = Date.UTC(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1);
  const toUtc = Date.UTC(ty ?? 1970, (tm ?? 1) - 1, td ?? 1);
  return Math.round((toUtc - fromUtc) / MS_PER_DAY);
}

function formatScheduledLabel(ts: number, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat("en-NZ", { timeZone, day: "numeric", month: "short" }).format(
    new Date(ts),
  );
  return `due ${formatted}`;
}

/**
 * The row's display state, from the "effective due instant" table in the contract's
 * amendments (A2): the open instance's `dueAt` when there is one, compared by *calendar
 * day* in `ctx.timeZone` -- not by raw instant, which is what the domain's own
 * `isOverdue` uses for health decay. A chore due at 8am today is "due today" all day,
 * never "overdue", even though `isOverdue` would already say yes by 9am. That distinction
 * is display-only, so it lives here rather than being pulled from the domain.
 */
function computeRowState(
  ctx: DomainCtx,
  dueAt: number | null,
): { state: ChoreRowState; overdueDays: number; dueLabel: string } {
  if (dueAt === null || !Number.isFinite(dueAt)) {
    return { state: "unscheduled", overdueDays: 0, dueLabel: "not scheduled" };
  }
  const todayKey = dayKey(ctx.now, ctx.timeZone);
  const dueKey = dayKey(dueAt, ctx.timeZone);
  const diff = calendarDaysBetween(dueKey, todayKey);
  if (diff > 0) {
    return { state: "overdue", overdueDays: diff, dueLabel: `${diff} day${diff === 1 ? "" : "s"} overdue` };
  }
  if (diff === 0) {
    return { state: "due", overdueDays: 0, dueLabel: "due today" };
  }
  return { state: "scheduled", overdueDays: 0, dueLabel: formatScheduledLabel(dueAt, ctx.timeZone) };
}

function buildOverdueList(ctx: DomainCtx, household: Household): OverdueChore[] {
  const choresById = new Map(household.chores.map((c) => [c.id, c] as const));
  const list: OverdueChore[] = [];
  for (const instance of household.instances) {
    const chore = choresById.get(instance.choreId);
    if (chore === undefined) continue;
    if (!isOverdue(ctx, instance)) continue;
    list.push({ instance, chore });
  }
  return list;
}

function recurrenceFromDraft(draft: ChoreDraft): Recurrence | null {
  if (!Number.isFinite(draft.recurrenceN) || draft.recurrenceN <= 0) return null;
  if (draft.recurrenceUnit === "timesPerYear") {
    return { kind: "timesPerYear", timesPerYear: draft.recurrenceN };
  }
  if (RECURRENCE_UNITS.has(draft.recurrenceUnit)) {
    return { kind: "interval", unit: draft.recurrenceUnit as RecurrenceUnit, n: draft.recurrenceN };
  }
  return null;
}

function draftFromChore(chore: Chore): ChoreDraft {
  let recurrenceUnit = "";
  let recurrenceN = 0;
  if (chore.recurrence !== null) {
    if (chore.recurrence.kind === "interval") {
      recurrenceUnit = chore.recurrence.unit;
      recurrenceN = chore.recurrence.n;
    } else {
      recurrenceUnit = "timesPerYear";
      recurrenceN = chore.recurrence.timesPerYear;
    }
  }
  return {
    id: chore.id,
    title: chore.title,
    assetId: chore.assetId,
    time: chore.weight.time,
    effort: chore.weight.effort,
    priority: chore.weight.priority,
    recurrenceUnit,
    recurrenceN,
    deadlineDate: chore.deadlineDate ?? "",
    leadTimeDays: chore.leadTimeDays,
  };
}

const EMPTY_DRAFT: ChoreDraft = {
  id: null,
  title: "",
  assetId: "",
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
  #base: Household = EMPTY_HOUSEHOLD;
  /** The last computed household (base + queue overlay). What `tick` looks up against. */
  #current: Household = EMPTY_HOUSEHOLD;

  constructor(deps: ChoreListPresenterDeps) {
    super({
      status: "loading",
      error: null,
      rows: [],
      assets: [],
      rescue: null,
      isEmpty: false,
      queueSize: 0,
      syncError: null,
      editing: null,
      editingPoints: 0,
      busy: false,
    });
    this.#deps = deps;
  }

  /** snapshot -> applyPending -> setState. */
  async load(): Promise<void> {
    this.setState({ ...this.state, status: "loading", error: null });
    try {
      const envelope = await this.#deps.gateway.snapshot();
      if (!envelope.ok || envelope.data === undefined) {
        this.setState({ ...this.state, status: "error", error: envelope.error ?? "Could not load the household." });
        return;
      }
      this.#base = householdFromSnapshot(envelope.data, envelope.version);
    } catch {
      this.setState({
        ...this.state,
        status: "error",
        error: "Could not reach the server. Check your connection and try again.",
      });
      return;
    }
    await this.#render();
    // Opportunistically drain anything left over from a previous session (e.g. a tick
    // made while offline, still sitting in the queue from before this reload).
    const pending = await this.#deps.queue.size();
    if (pending > 0) void this.#flush();
  }

  /** Same as `load`, used to prove flow 47: pulls the other person's changes into a
   *  live app whose queue is not empty, without disturbing the overlay. */
  async refresh(): Promise<void> {
    return this.load();
  }

  async tick(choreId: string): Promise<void> {
    const instance = this.#current.instances.find((i) => i.choreId === choreId) ?? null;
    const instanceId = instance?.instanceId ?? this.#deps.newId();
    // ISO-8601 with offset, not epoch millis. `opComplete_` writes this value straight
    // into the `Completions.completedAt` cell with `asText_`, and every timestamp column
    // in that sheet is ISO text — a number would land in the column as a number, and
    // every later read of it, here and on the server, would fail to parse.
    const completedAt = new Date(this.#deps.now()).toISOString();
    await this.#deps.queue.enqueue("complete", { instanceId, choreId, completedAt });
    // The render, and nothing above this line may await the network.
    await this.#render();
    void this.#flush();
  }

  async seedDefaults(): Promise<void> {
    this.setState({ ...this.state, busy: true });
    await this.#deps.queue.enqueue("household.seed", {});
    this.setState({ ...this.state, busy: false });
    await this.#render();
    void this.#flush();
  }

  startCreate(): void {
    const firstAsset = this.state.assets[0]?.id ?? "";
    const draft: ChoreDraft = { ...EMPTY_DRAFT, assetId: firstAsset };
    this.setState({
      ...this.state,
      editing: draft,
      editingPoints: weight({ time: draft.time, effort: draft.effort, priority: draft.priority }),
    });
  }

  startEdit(choreId: string): void {
    const chore = this.#current.chores.find((c) => c.id === choreId);
    if (chore === undefined) return;
    const draft = draftFromChore(chore);
    this.setState({ ...this.state, editing: draft, editingPoints: weight(chore.weight) });
  }

  changeDraft(patch: Partial<ChoreDraft>): void {
    if (this.state.editing === null) return;
    const editing = { ...this.state.editing, ...patch };
    this.setState({
      ...this.state,
      editing,
      editingPoints: weight({ time: editing.time, effort: editing.effort, priority: editing.priority }),
    });
  }

  cancelEdit(): void {
    this.setState({ ...this.state, editing: null, editingPoints: 0 });
  }

  async saveDraft(): Promise<void> {
    const draft = this.state.editing;
    if (draft === null) return;
    this.setState({ ...this.state, busy: true });

    const ctx = makeCtx(this.#deps.now, this.#deps.timeZone);
    const recurrence = recurrenceFromDraft(draft);
    const isNew = draft.id === null;
    const id = draft.id ?? this.#deps.newId();
    const deadlineDate = draft.deadlineDate === "" ? null : draft.deadlineDate;

    const basePayload: Record<string, string> = {
      id,
      title: draft.title,
      assetId: draft.assetId,
      weightTime: String(draft.time),
      weightEffort: String(draft.effort),
      weightPriority: String(draft.priority),
      recurrenceUnit: draft.recurrenceUnit,
      recurrenceN: String(draft.recurrenceN),
      deadlineDate: draft.deadlineDate,
      leadTimeDays: draft.leadTimeDays === null ? "" : String(draft.leadTimeDays),
    };

    let op: string;
    let payload: Record<string, string>;

    if (isNew) {
      const chore: Chore = {
        id,
        title: draft.title,
        assetId: draft.assetId,
        weight: { time: draft.time, effort: draft.effort, priority: draft.priority },
        recurrence,
        deadlineDate,
        leadTimeDays: draft.leadTimeDays,
        urgencyCurve: null,
      };
      let nextDueAt = "";
      if (recurrence !== null) {
        try {
          nextDueAt = new Date(nextDueFrom(ctx, ctx.now, chore)).toISOString();
        } catch {
          // A recurrence that will not parse keeps the chore unscheduled rather than
          // taking the save down with it -- mirrors nextDueFrom's own finite-input guard.
          nextDueAt = "";
        }
      } else if (deadlineDate !== null && deadlineDate !== "") {
        const parsed = Date.parse(`${deadlineDate}T00:00:00.000Z`);
        nextDueAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
      }
      op = "chore.create";
      payload = { ...basePayload, nextDueAt, deletedAt: "" };
    } else {
      // nextDueAt is left off an update: the server keeps whatever it already has.
      op = "chore.update";
      payload = { ...basePayload };
    }

    await this.#deps.queue.enqueue(op, payload);
    this.setState({ ...this.state, editing: null, editingPoints: 0, busy: false });
    await this.#render();
    void this.#flush();
  }

  async deleteChore(choreId: string): Promise<void> {
    this.setState({ ...this.state, busy: true });
    await this.#deps.queue.enqueue("chore.delete", { id: choreId });
    this.setState({ ...this.state, busy: false, editing: null, editingPoints: 0 });
    await this.#render();
    void this.#flush();
  }

  async retrySync(): Promise<void> {
    await this.#flush();
  }

  /** Recompute the household (base + queue overlay) and derive every view value from it. */
  async #render(): Promise<void> {
    const queued = await this.#deps.queue.list();
    const ctx = makeCtx(this.#deps.now, this.#deps.timeZone);
    const household = applyPending(ctx, this.#base, queued, this.#deps.personId);
    this.#current = household;

    const pendingChoreIds = new Set<string>();
    for (const q of queued) {
      if (q.op !== "complete") continue;
      const p = q.payload as { choreId?: unknown };
      if (typeof p.choreId === "string") pendingChoreIds.add(p.choreId);
    }

    const overdueAll = buildOverdueList(ctx, household);

    const assets: AssetVM[] = household.assets.map((asset) => {
      const value = health(ctx, asset, overdueAll);
      const band = healthBand(value);
      const overdueCount = overdueAll.filter((o) => o.chore.assetId === asset.id).length;
      return { id: asset.id, kind: asset.kind, label: labelForKind(asset.kind), health: value, band, overdueCount };
    });

    const brokenDown = assets.some((a) => a.band === "broken-down");
    let rescueVM: RescueVM | null = null;
    if (brokenDown) {
      const r = rescueRule(ctx, overdueAll);
      rescueVM = {
        overdueCount: r.overdueCount,
        recommendedChoreId: r.recommended?.id ?? null,
        recommendedTitle: r.recommended?.title ?? null,
        bonusPoints: r.bonusPoints,
      };
    }

    const rows: ChoreRowVM[] = household.chores.map((chore) => {
      const dueAt = effectiveDueAt(household, chore.id);
      const { state, overdueDays, dueLabel } = computeRowState(ctx, dueAt);
      const asset = household.assets.find((a) => a.id === chore.assetId);
      return {
        id: chore.id,
        title: chore.title,
        assetId: chore.assetId,
        assetLabel: asset !== undefined ? labelForKind(asset.kind) : chore.assetId,
        points: hasReadableWeight(chore) ? weight(chore.weight) : 0,
        state,
        overdueDays,
        dueLabel,
        pending: pendingChoreIds.has(chore.id),
        canTick: true,
      };
    });

    this.setState({
      ...this.state,
      status: "ready",
      error: null,
      rows,
      assets,
      rescue: rescueVM,
      isEmpty: household.chores.length === 0,
      queueSize: queued.length,
    });
  }

  /** Fire-and-forget drain of the queue. Never awaited from `tick`. */
  async #flush(): Promise<void> {
    const outcome = await this.#deps.queue.flush(this.#deps.gateway);
    if (outcome.halted) {
      this.setState({ ...this.state, syncError: outcome.error });
      return;
    }
    const remaining = await this.#deps.queue.size();
    if (remaining === 0) {
      // A4: without re-fetching, the base household is still stale and the overlay is
      // now empty, so a chore just ticked would snap back to its pre-tick state.
      await this.#reloadAfterFlush();
    } else {
      await this.#render();
    }
  }

  async #reloadAfterFlush(): Promise<void> {
    try {
      const envelope = await this.#deps.gateway.snapshot();
      if (!envelope.ok || envelope.data === undefined) {
        this.setState({ ...this.state, syncError: envelope.error ?? "Could not refresh after syncing." });
        return;
      }
      this.#base = householdFromSnapshot(envelope.data, envelope.version);
    } catch {
      this.setState({ ...this.state, syncError: "Synced, but could not refresh the latest changes." });
      return;
    }
    await this.#render();
    this.setState({ ...this.state, syncError: null });
  }
}
