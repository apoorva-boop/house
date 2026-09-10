import { Presenter } from "../app/Presenter.js";
import { makeCtx, type Clock } from "../app/ctx.js";
import type { Gateway } from "../gateway/SheetsGateway.js";
import type { MutationQueue } from "../offline/MutationQueue.js";
import { EMPTY_HOUSEHOLD, householdFromSnapshot, type Household } from "../model/Household.js";
import {
  approve,
  decline,
  fairness,
  health,
  healthBand,
  isOverdue,
  propose,
  NO_RESET,
  type DomainCtx,
  type OverdueChore,
  type ResetProposal,
} from "@house/domain";

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

const RESET_KEY = "house.reset";
const MAX_RECENT = 20;

interface StoredReset {
  readonly proposal: ResetProposal;
  readonly scoresClearedAt: number | null;
}

function isResetProposal(value: unknown): value is ResetProposal {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const states = new Set(["none", "proposed", "approved", "declined"]);
  return typeof v["state"] === "string" && states.has(v["state"]) && (v["proposedBy"] === null || typeof v["proposedBy"] === "string");
}

function labelForKind(kind: string): string {
  if (kind === "house") return "House";
  if (kind === "garden") return "Garden";
  if (kind === "car") return "Car";
  return kind.length > 0 ? kind[0]!.toUpperCase() + kind.slice(1) : kind;
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

function formatWhen(ts: number, timeZone: string): string {
  if (!Number.isFinite(ts)) return "";
  return new Intl.DateTimeFormat("en-NZ", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
}

const EMPTY_RESET_VM: ResetVM = { state: "none", proposedByName: null, canPropose: true, canApprove: false, canDecline: false };

/**
 * Server-confirmed completions only (amendment A5). Points are authoritative from the
 * server; the client's own `weight()` is an estimate, and an estimate in the historical
 * record is the phantom completion flow 45 exists to catch. `queue` is kept as a
 * dependency (per the contract) purely so a future screen can say how many changes are
 * not yet synced -- as a count, never folded into any total here.
 */
export class StatsPresenter extends Presenter<StatsViewState> {
  readonly #deps: StatsPresenterDeps;
  #household: Household = EMPTY_HOUSEHOLD;

  constructor(deps: StatsPresenterDeps) {
    super({
      status: "loading",
      error: null,
      windowPoints: 0,
      people: [],
      assets: [],
      recent: [],
      reset: EMPTY_RESET_VM,
    });
    this.#deps = deps;
  }

  async load(): Promise<void> {
    this.setState({ ...this.state, status: "loading", error: null });
    try {
      const envelope = await this.#deps.gateway.snapshot();
      if (!envelope.ok || envelope.data === undefined) {
        this.setState({ ...this.state, status: "error", error: envelope.error ?? "Could not load stats." });
        return;
      }
      this.#household = householdFromSnapshot(envelope.data, envelope.version);
    } catch {
      this.setState({
        ...this.state,
        status: "error",
        error: "Could not reach the server. Check your connection and try again.",
      });
      return;
    }
    this.#render();
  }

  proposeReset(): void {
    const reset = this.#loadReset();
    const proposal = propose(this.#deps.personId);
    this.#saveReset({ proposal, scoresClearedAt: reset.scoresClearedAt });
    this.#render();
  }

  approveReset(): void {
    const reset = this.#loadReset();
    const approved = approve(reset.proposal, this.#deps.personId);
    const scoresClearedAt = approved.state === "approved" ? this.#deps.now() : reset.scoresClearedAt;
    this.#saveReset({ proposal: approved, scoresClearedAt });
    this.#render();
  }

  declineReset(): void {
    const reset = this.#loadReset();
    const declined = decline(reset.proposal, this.#deps.personId);
    this.#saveReset({ proposal: declined, scoresClearedAt: reset.scoresClearedAt });
    this.#render();
  }

  #loadReset(): StoredReset {
    const raw = this.#deps.store.getItem(RESET_KEY);
    if (raw === null) return { proposal: NO_RESET, scoresClearedAt: null };
    try {
      const parsed = JSON.parse(raw) as { proposal?: unknown; scoresClearedAt?: unknown };
      const proposal = isResetProposal(parsed.proposal) ? parsed.proposal : NO_RESET;
      const scoresClearedAt = typeof parsed.scoresClearedAt === "number" ? parsed.scoresClearedAt : null;
      return { proposal, scoresClearedAt };
    } catch {
      return { proposal: NO_RESET, scoresClearedAt: null };
    }
  }

  #saveReset(reset: StoredReset): void {
    this.#deps.store.setItem(RESET_KEY, JSON.stringify(reset));
  }

  #buildResetVM(proposal: ResetProposal): ResetVM {
    const proposedByName =
      proposal.proposedBy !== null
        ? (this.#household.people.find((p) => p.id === proposal.proposedBy)?.displayName ?? proposal.proposedBy)
        : null;
    return {
      state: proposal.state,
      proposedByName,
      canPropose: proposal.state !== "proposed",
      canApprove: proposal.state === "proposed" && proposal.proposedBy !== this.#deps.personId,
      canDecline: proposal.state === "proposed",
    };
  }

  /** Pure and synchronous: everything it reads (`#household`, `house.reset`) is already
   *  in hand, so `propose`/`approve`/`decline` can update the screen without a tick of
   *  network latency in between. */
  #render(): void {
    const ctx = makeCtx(this.#deps.now, this.#deps.timeZone);
    const household = this.#household;
    const reset = this.#loadReset();
    const scoresClearedAt = reset.scoresClearedAt;

    // A6: reset clears the *window*, not the backlog. Asset totals and the recent list
    // below are never filtered by this cutoff.
    const windowCompletions =
      scoresClearedAt !== null ? household.completions.filter((c) => c.completedAt > scoresClearedAt) : household.completions;

    const personIds = household.people.map((p) => p.id);
    const fairnessResult = fairness(ctx, windowCompletions, personIds);

    const people: PersonStatsVM[] = household.people.map((p) => {
      const pf = fairnessResult.byPerson[p.id];
      const completions = household.completions.filter((c) => c.personId === p.id).length;
      return {
        id: p.id,
        displayName: p.displayName,
        isYou: p.id === this.#deps.personId,
        points: pf?.points ?? 0,
        sharePct: Math.round((pf?.share ?? 0) * 100),
        tier: pf?.tier ?? 0,
        completions,
      };
    });

    const overdueAll = buildOverdueList(ctx, household);
    const assets: AssetStatsVM[] = household.assets.map((asset) => {
      const assetCompletions = household.completions.filter((c) => c.assetId === asset.id);
      const points = assetCompletions.reduce(
        (sum, c) => sum + (Number.isFinite(c.pointsAwarded) ? Math.max(0, c.pointsAwarded) : 0),
        0,
      );
      const value = health(ctx, asset, overdueAll);
      return {
        id: asset.id,
        kind: asset.kind,
        label: labelForKind(asset.kind),
        points,
        completions: assetCompletions.length,
        health: value,
        band: healthBand(value),
      };
    });

    const recent: RecentCompletionVM[] = [...household.completions]
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, MAX_RECENT)
      .map((c) => {
        const asset = household.assets.find((a) => a.id === c.assetId);
        const person = household.people.find((p) => p.id === c.personId);
        return {
          mutationId: c.mutationId,
          choreTitle: c.choreTitle,
          assetLabel: asset !== undefined ? labelForKind(asset.kind) : c.assetId,
          personName: person?.displayName ?? c.personId,
          points: c.pointsAwarded,
          whenLabel: formatWhen(c.completedAt, this.#deps.timeZone),
        };
      });

    this.setState({
      status: "ready",
      error: null,
      windowPoints: fairnessResult.windowPoints,
      people,
      assets,
      recent,
      reset: this.#buildResetVM(reset.proposal),
    });
  }
}
