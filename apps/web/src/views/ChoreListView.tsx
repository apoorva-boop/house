import { useSyncExternalStore } from "react";
import type { ChoreListPresenter } from "../presenters/ChoreListPresenter.js";
import { ChoreEditorView } from "./ChoreEditorView.js";

export function ChoreListView({ presenter }: { presenter: ChoreListPresenter }) {
  const state = useSyncExternalStore(presenter.subscribe, presenter.snapshot);
  const editing = state.editing;

  return (
    <section className="chore-list" data-testid="chore-list" aria-label="Chores">
      {state.isEmpty ? (
        <div className="empty-state">
          <p>No chores yet.</p>
          <button
            type="button"
            data-testid="seed-defaults"
            aria-disabled={state.busy}
            onClick={() => {
              if (state.busy) return;
              void presenter.seedDefaults();
            }}
          >
            Add starter chores
          </button>
        </div>
      ) : (
        <>
          {state.rescue !== null && (
            <div className="rescue-banner" data-testid="rescue-banner" role="status">
              <p>{state.rescue.overdueCount} chores overdue.</p>
              {state.rescue.recommendedTitle !== null && (
                <p>
                  Try: {state.rescue.recommendedTitle} for {state.rescue.bonusPoints} bonus points.
                </p>
              )}
            </div>
          )}

          <div className="asset-row">
            {state.assets.map((asset) => (
              <div key={asset.id} className="asset-card">
                <span className="asset-label" aria-hidden="true">
                  {asset.label}
                </span>
                <span
                  className="asset-health"
                  data-testid="asset-health"
                  data-asset-id={asset.id}
                  data-band={asset.band}
                  aria-label={`${asset.label} health`}
                >
                  {asset.health}
                </span>
              </div>
            ))}
          </div>

          <div className="list-actions">
            <button
              type="button"
              data-testid="refresh"
              onClick={() => {
                void presenter.refresh();
              }}
            >
              Refresh
            </button>
          </div>

          <ul className="chore-rows">
            {state.rows.map((row) => (
              <li
                key={row.id}
                className="chore-row"
                data-testid="chore-row"
                data-chore-id={row.id}
                data-state={row.state}
                data-pending={String(row.pending)}
              >
                <span className="chore-title" data-testid="chore-title">
                  {row.title}
                </span>
                <span className="chore-due" data-testid="chore-due">
                  {row.dueLabel}
                </span>
                <button
                  type="button"
                  className="chore-tick"
                  data-testid="chore-tick"
                  aria-label={`Mark ${row.title} done`}
                  aria-disabled={!row.canTick}
                  onClick={() => {
                    if (!row.canTick) return;
                    void presenter.tick(row.id);
                  }}
                >
                  Done
                </button>
                <button
                  type="button"
                  className="chore-edit"
                  data-testid="chore-edit"
                  aria-label={`Edit ${row.title}`}
                  onClick={() => {
                    presenter.startEdit(row.id);
                  }}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing !== null && (
        <ChoreEditorView
          draft={editing}
          points={state.editingPoints}
          assets={state.assets}
          onChange={(patch) => {
            presenter.changeDraft(patch);
          }}
          onSave={() => {
            void presenter.saveDraft();
          }}
          onCancel={() => {
            presenter.cancelEdit();
          }}
          onDelete={
            editing.id !== null
              ? () => {
                  void presenter.deleteChore(editing.id!);
                }
              : null
          }
        />
      )}
    </section>
  );
}
