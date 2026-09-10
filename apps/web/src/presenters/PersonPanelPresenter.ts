import { Presenter } from "../app/Presenter.js";
import type { StatsPresenter } from "./StatsPresenter.js";

export interface PersonPanelViewState {
  readonly open: boolean;
  readonly personId: string | null;
  readonly displayName: string;
  readonly tier: number;
  readonly tierLabel: string;
  readonly points: number;
  readonly sharePct: number;
}

export interface PersonPanelPresenterDeps {
  readonly stats: StatsPresenter;
}

const EMPTY_STATE: PersonPanelViewState = {
  open: false,
  personId: null,
  displayName: "",
  tier: 0,
  tierLabel: "",
  points: 0,
  sharePct: 0,
};

/**
 * The plain-English word for one of `fairness()`'s five exhaustion steps (0, 0.2,
 * 0.4, 0.6, 0.8) -- `data-tier` stays the raw number for tests, but a person reads
 * words, not a decimal. Mirrors the endpoints `Character.tsx` already names in its
 * own pose comments ("fresh" at 0, "worn out" at 0.8). Falls back to the raw number
 * so an unrecognised value is still visible rather than blank.
 */
function describeTier(tier: number): string {
  switch (tier) {
    case 0:
      return "fresh";
    case 0.2:
      return "a little tired";
    case 0.4:
      return "tired";
    case 0.6:
      return "worn down";
    case 0.8:
      return "worn out";
    default:
      return String(tier);
  }
}

/**
 * Derives the person panel entirely from `StatsPresenter`'s own `people` list — never
 * calls `@house/domain` again. The tier, points and share shown here are the exact
 * numbers `fairness()` already produced for the stats screen and the map's character
 * overlay, so all three can never disagree about the same person.
 */
export class PersonPanelPresenter extends Presenter<PersonPanelViewState> {
  readonly #deps: PersonPanelPresenterDeps;

  constructor(deps: PersonPanelPresenterDeps) {
    super(EMPTY_STATE);
    this.#deps = deps;
    deps.stats.subscribe(() => {
      this.#refresh();
    });
  }

  open(personId: string): void {
    const person = this.#deps.stats.state.people.find((p) => p.id === personId);
    if (person === undefined) return;
    this.setState({
      open: true,
      personId,
      displayName: person.displayName,
      tier: person.tier,
      tierLabel: describeTier(person.tier),
      points: person.points,
      sharePct: person.sharePct,
    });
  }

  close(): void {
    this.setState({ ...this.state, open: false });
  }

  #refresh(): void {
    if (!this.state.open || this.state.personId === null) return;
    const person = this.#deps.stats.state.people.find((p) => p.id === this.state.personId);
    if (person === undefined) return;
    this.setState({
      ...this.state,
      displayName: person.displayName,
      tier: person.tier,
      tierLabel: describeTier(person.tier),
      points: person.points,
      sharePct: person.sharePct,
    });
  }
}
