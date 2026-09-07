// STUB - phase 3. Routes between setup, chores and stats using AppPresenter's real
// navigation, but the screens it routes to are themselves stubs.
import { useSyncExternalStore } from "react";
import type { AppPresenter } from "../app/AppPresenter.js";
import type { ChoreListPresenter } from "../presenters/ChoreListPresenter.js";
import { SetupView } from "./SetupView.js";
import { ChoreListView } from "./ChoreListView.js";
import { StatsView } from "./StatsView.js";

function SyncStatus({ choreList }: { choreList: ChoreListPresenter }) {
  const cl = useSyncExternalStore(choreList.subscribe, choreList.snapshot);

  return (
    <div className="sync-status">
      {cl.queueSize > 0 && (
        <span className="queue-badge" data-testid="queue-badge" data-count={cl.queueSize}>
          {cl.queueSize} pending
        </span>
      )}
      {cl.syncError !== null && (
        <div className="sync-error" data-testid="sync-error" role="alert">
          <p>{cl.syncError}</p>
          <button
            type="button"
            data-testid="sync-retry"
            onClick={() => {
              void choreList.retrySync();
            }}
          >
            Retry sync
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell({ app }: { app: AppPresenter }) {
  const state = useSyncExternalStore(app.subscribe, app.snapshot);
  const choreList = app.choreList;
  const stats = app.stats;

  if (state.screen === "setup" || choreList === null || stats === null) {
    return <SetupView presenter={app.setup} />;
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      <nav className="shell-nav" aria-label="Primary">
        <button
          type="button"
          data-testid="nav-chores"
          aria-current={state.screen === "chores" ? "page" : undefined}
          onClick={() => {
            app.navigate("chores");
          }}
        >
          Chores
        </button>
        <button
          type="button"
          data-testid="nav-stats"
          aria-current={state.screen === "stats" ? "page" : undefined}
          onClick={() => {
            app.navigate("stats");
          }}
        >
          Stats
        </button>
        <button
          type="button"
          data-testid="nav-add"
          onClick={() => {
            choreList.startCreate();
          }}
        >
          Add chore
        </button>
      </nav>

      <SyncStatus choreList={choreList} />

      <main>{state.screen === "stats" ? <StatsView presenter={stats} /> : <ChoreListView presenter={choreList} />}</main>
    </div>
  );
}
