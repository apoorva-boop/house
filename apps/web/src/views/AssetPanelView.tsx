// Dumb over AssetPanelPresenter's state — the panel's own filtering (overdue chores on
// this asset only) already happened in the presenter; this only renders the rows it is
// handed.
import type { KeyboardEvent, PointerEvent, Ref } from "react";
import type { AssetPanelViewState } from "../presenters/AssetPanelPresenter.js";

export interface AssetPanelViewProps {
  readonly state: AssetPanelViewState;
  readonly onTick: (choreId: string) => void;
  readonly onClose: () => void;
  readonly panelRef: Ref<HTMLDivElement>;
  readonly onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  readonly onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
}

export function AssetPanelView({
  state,
  onTick,
  onClose,
  panelRef,
  onKeyDown,
  onPointerDown,
  onPointerUp,
}: AssetPanelViewProps) {
  if (state.assetId === null) return null;

  return (
    <div
      ref={panelRef}
      data-testid="asset-panel"
      role="dialog"
      aria-modal="true"
      aria-label={state.label}
      data-asset-id={state.assetId}
      data-band={state.band}
      tabIndex={-1}
      className="panel-sheet"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <h2 data-testid="panel-title">{state.label}</h2>
      <span data-testid="panel-health">{state.health}</span>
      <ul className="panel-chore-rows">
        {state.chores.map((chore) => (
          <li key={chore.id} data-testid="panel-chore-row" data-chore-id={chore.id} className="panel-chore-row">
            <span data-testid="panel-chore-title" className="panel-chore-title">
              {chore.title}
            </span>
            <span data-testid="panel-chore-due" className="panel-chore-due">
              {chore.dueLabel}
            </span>
            <button
              type="button"
              data-testid="panel-chore-tick"
              disabled={chore.pending}
              onClick={() => {
                onTick(chore.id);
              }}
            >
              Done
            </button>
          </li>
        ))}
      </ul>
      <button type="button" data-testid="panel-close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
