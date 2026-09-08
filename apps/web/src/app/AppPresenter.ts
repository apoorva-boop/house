import { Presenter } from "./Presenter.js";
import { browserTimeZone } from "./ctx.js";
import { loadCredentials, type Credentials } from "./credentials.js";
import {
  SheetsGateway,
  type Envelope,
  type Gateway,
  type SnapshotData,
} from "../gateway/SheetsGateway.js";
import { MutationQueue } from "../offline/MutationQueue.js";
import { SetupPresenter } from "../presenters/SetupPresenter.js";
import { ChoreListPresenter } from "../presenters/ChoreListPresenter.js";
import { StatsPresenter } from "../presenters/StatsPresenter.js";

export type Screen = "setup" | "chores" | "stats";

export interface AppViewState {
  readonly screen: Screen;
  readonly credentials: Credentials | null;
}

export interface AppPresenterDeps {
  readonly store: Storage;
  readonly idb: IDBFactory;
  readonly newId: () => string;
  readonly now: () => number;
}

function makeGateway(execUrl: string, token: string): Gateway {
  return new SheetsGateway(execUrl, token);
}

const SNAPSHOT_CACHE_KEY = "house.snapshotCache";

interface CachedSnapshot {
  readonly data: SnapshotData;
  readonly version: number;
  readonly serverTime: string;
}

/**
 * Wraps a `Gateway` so a transport failure on `snapshot()` falls back to the last
 * successful response, cached in `store`. Every mutation (`post`) still goes straight
 * through, live, to `inner` -- no non-negotiable-3 violation, no second file calling
 * `fetch`, this only decorates the existing gateway's own calls. Only the read path
 * degrades.
 *
 * This is what lets a chore ticked while offline still show its full, correct state
 * (title, recurrence-advanced due date) after the tab is reloaded with the network
 * still down: without a cached base to overlay it onto, `applyPending` would have
 * nothing to work with, because a queued `complete` mutation carries only
 * `{instanceId, choreId, completedAt}` -- not the chore's own title or recurrence.
 */
function withSnapshotCache(inner: Gateway, store: Storage): Gateway {
  // Two presenters share one gateway and both load on boot, so two identical snapshot
  // requests would go out a millisecond apart. This holds the first one's promise and
  // hands it to anyone who asks while it is still in flight -- one round trip, both
  // callers, same answer. It is not a cache across time: the moment it settles the slot
  // is cleared, so a later refresh really does refetch.
  let inFlight: Promise<Envelope<SnapshotData>> | null = null;

  return {
    post: (op, payload, mutationId) => inner.post(op, payload, mutationId),
    snapshot() {
      if (inFlight !== null) return inFlight;
      const request = fetchSnapshot();
      inFlight = request;
      void request.finally(() => {
        if (inFlight === request) inFlight = null;
      });
      return request;
    },
  };

  async function fetchSnapshot(): Promise<Envelope<SnapshotData>> {
    try {
      const envelope = await inner.snapshot();
      if (envelope.ok && envelope.data !== undefined) {
        try {
          const cached: CachedSnapshot = {
            data: envelope.data,
            version: envelope.version,
            serverTime: envelope.serverTime,
          };
          store.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(cached));
        } catch {
          // The cache is a convenience, not a requirement: a full or disabled store
          // must not turn a successful load into a failure.
        }
      }
      return envelope;
    } catch (err) {
      const raw = store.getItem(SNAPSHOT_CACHE_KEY);
      if (raw === null) throw err;
      try {
        const cached = JSON.parse(raw) as CachedSnapshot;
        return {
          ok: true,
          data: cached.data,
          serverTime: cached.serverTime,
          version: cached.version,
        };
      } catch {
        throw err;
      }
    }
  }
}

/**
 * Root presenter. Owns which screen Shell.tsx shows and constructs the per-screen
 * presenters once credentials exist — either already in `Storage` at boot, or handed
 * over by SetupPresenter's `onReady`.
 */
export class AppPresenter extends Presenter<AppViewState> {
  readonly setup: SetupPresenter;
  readonly #deps: AppPresenterDeps;
  choreList: ChoreListPresenter | null = null;
  stats: StatsPresenter | null = null;

  constructor(deps: AppPresenterDeps) {
    const existing = loadCredentials(deps.store);
    super({
      screen: existing !== null ? "chores" : "setup",
      credentials: existing,
    });
    this.#deps = deps;
    this.setup = new SetupPresenter({
      makeGateway,
      store: deps.store,
      onReady: (c) => {
        this.#onReady(c);
      },
    });
    if (existing !== null) this.#wire(existing);
  }

  #wire(c: Credentials): void {
    const gateway = withSnapshotCache(
      makeGateway(c.execUrl, c.token),
      this.#deps.store,
    );
    const queue = new MutationQueue(
      this.#deps.idb,
      this.#deps.newId,
      this.#deps.now,
    );
    const timeZone = browserTimeZone();
    this.choreList = new ChoreListPresenter({
      gateway,
      queue,
      now: this.#deps.now,
      timeZone,
      personId: c.personId,
      newId: this.#deps.newId,
    });
    this.stats = new StatsPresenter({
      gateway,
      queue,
      now: this.#deps.now,
      timeZone,
      personId: c.personId,
      store: this.#deps.store,
    });
    void this.choreList.load();
    void this.stats.load();
  }

  #onReady(c: Credentials): void {
    this.#wire(c);
    this.setState({ screen: "chores", credentials: c });
  }

  navigate(screen: Screen): void {
    this.setState({ ...this.state, screen });
  }
}
