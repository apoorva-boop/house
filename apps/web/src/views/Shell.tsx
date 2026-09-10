// Routes between setup, chores and stats using AppPresenter's navigation state, and
// owns the sync status (queue badge / sync error) that sits above whichever screen is
// showing.
import { useSyncExternalStore } from "react";
import type { AppPresenter } from "../app/AppPresenter.js";
import type { ChoreListPresenter } from "../presenters/ChoreListPresenter.js";
import { SetupView } from "./SetupView.js";
import { ChoreListView } from "./ChoreListView.js";
import { StatsView } from "./StatsView.js";
import { MapScreen } from "./MapScreen.js";

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
  const map = app.map;
  const assetPanel = app.assetPanel;
  const personPanel = app.personPanel;

  if (
    state.screen === "setup" ||
    choreList === null ||
    stats === null ||
    map === null ||
    assetPanel === null ||
    personPanel === null
  ) {
    return <SetupView presenter={app.setup} />;
  }

  // Shared by the map's own toolbar and the classic shell-nav below: "add a chore"
  // always means "show the editor", and the editor only renders inside ChoreListView,
  // so reaching it from anywhere (including the map, the app's launch screen) means
  // navigating to "chores" first.
  const startAddChore = () => {
    app.navigate("chores");
    choreList.startCreate();
  };

  if (state.screen === "map") {
    return (
      <MapScreen
        map={map}
        assetPanel={assetPanel}
        personPanel={personPanel}
        onNavChores={() => {
          app.navigate("chores");
        }}
        onNavStats={() => {
          app.navigate("stats");
        }}
        onAddChore={startAddChore}
      />
    );
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      <nav className="shell-nav" aria-label="Primary">
        <button
          type="button"
          data-testid="nav-map"
          onClick={() => {
            app.navigate("map");
          }}
        >
          Map
        </button>
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
        <button type="button" data-testid="nav-add" onClick={startAddChore}>
          Add chore
        </button>
      </nav>

      <div className="app-content">
        <SyncStatus choreList={choreList} />
        <main>{state.screen === "stats" ? <StatsView presenter={stats} /> : <ChoreListView presenter={choreList} />}</main>
      </div>
    </div>
  );
}
