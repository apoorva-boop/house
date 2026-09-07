// STUB - phase 3. Renders the presenter's seeded fake stats. `reset-propose` is the
// only reset control visible at first, matching the real "none" starting state;
// clicking it is a no-op, so a test that expects the state to advance to "proposed"
// fails on that assertion.
import { useSyncExternalStore } from "react";
import type { StatsPresenter } from "../presenters/StatsPresenter.js";

export function StatsView({ presenter }: { presenter: StatsPresenter }) {
  const state = useSyncExternalStore(presenter.subscribe, presenter.snapshot);

  return (
    <section className="stats-screen" data-testid="stats-screen" aria-label="Stats">
      <p data-testid="stats-window-points">{state.windowPoints}</p>

      <ul className="stats-people">
        {state.people.map((person) => (
          <li
            key={person.id}
            className="stats-person"
            data-testid="stats-person"
            data-person-id={person.id}
            data-tier={person.tier}
          >
            <span>{person.displayName}</span>
            <span data-testid="stats-person-points">{person.points}</span>
            <span data-testid="stats-person-share">{person.sharePct}</span>
          </li>
        ))}
      </ul>

      <ul className="stats-assets">
        {state.assets.map((asset) => (
          <li key={asset.id} className="stats-asset" data-testid="stats-asset" data-asset-id={asset.id}>
            <span>{asset.label}</span>
            <span data-testid="stats-asset-points">{asset.points}</span>
            <span data-testid="stats-asset-completions">{asset.completions}</span>
          </li>
        ))}
      </ul>

      <ul className="stats-recent">
        {state.recent.map((row) => (
          <li
            key={row.mutationId}
            className="stats-recent-row"
            data-testid="stats-recent-row"
            data-mutation-id={row.mutationId}
          >
            <span>{row.choreTitle}</span>
            <span>{row.assetLabel}</span>
            <span>{row.personName}</span>
            <span>{row.points}</span>
            <span>{row.whenLabel}</span>
          </li>
        ))}
      </ul>

      <div className="reset-panel">
        <p data-testid="reset-state" data-state={state.reset.state}>
          {state.reset.state}
        </p>
        {state.reset.canPropose && (
          <button
            type="button"
            data-testid="reset-propose"
            onClick={() => {
              presenter.proposeReset();
            }}
          >
            Propose reset
          </button>
        )}
        {state.reset.canApprove && (
          <button
            type="button"
            data-testid="reset-approve"
            onClick={() => {
              presenter.approveReset();
            }}
          >
            Approve reset
          </button>
        )}
        {state.reset.canDecline && (
          <button
            type="button"
            data-testid="reset-decline"
            onClick={() => {
              presenter.declineReset();
            }}
          >
            Decline reset
          </button>
        )}
      </div>
    </section>
  );
}
