// Dumb over PersonPanelPresenter's state, same as AssetPanelView.
import type { KeyboardEvent, PointerEvent, Ref } from "react";
import type { PersonPanelViewState } from "../presenters/PersonPanelPresenter.js";

export interface PersonPanelViewProps {
  readonly state: PersonPanelViewState;
  readonly onClose: () => void;
  readonly panelRef: Ref<HTMLDivElement>;
  readonly onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  readonly onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
}

export function PersonPanelView({
  state,
  onClose,
  panelRef,
  onKeyDown,
  onPointerDown,
  onPointerUp,
}: PersonPanelViewProps) {
  if (state.personId === null) return null;

  return (
    <div
      ref={panelRef}
      data-testid="person-panel"
      role="dialog"
      aria-modal="true"
      aria-label={state.displayName}
      data-person-id={state.personId}
      tabIndex={-1}
      className="panel-sheet"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <h2 data-testid="person-panel-name">{state.displayName}</h2>
      {/* `data-tier` stays the raw fairness step for tests; `tierLabel` (the
          presenter's job, same as the asset panel's band) is what a person reads. */}
      <p className="panel-condition" data-testid="person-panel-tier" data-tier={state.tier}>
        {state.tierLabel}
      </p>
      <p className="panel-condition">
        <span data-testid="person-panel-points">{state.points}</span> points earned
      </p>
      <p className="panel-condition">
        <span data-testid="person-panel-share">{state.sharePct}%</span> of the work
      </p>
      <button type="button" data-testid="panel-close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
