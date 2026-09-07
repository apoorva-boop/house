import { Presenter } from "./Presenter.js";
import { browserTimeZone } from "./ctx.js";
import { loadCredentials, type Credentials } from "./credentials.js";
import { SheetsGateway, type Gateway } from "../gateway/SheetsGateway.js";
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
    super({ screen: existing !== null ? "chores" : "setup", credentials: existing });
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
    const gateway = makeGateway(c.execUrl, c.token);
    const queue = new MutationQueue(this.#deps.idb, this.#deps.newId, this.#deps.now);
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
  }

  #onReady(c: Credentials): void {
    this.#wire(c);
    this.setState({ screen: "chores", credentials: c });
  }

  navigate(screen: Screen): void {
    this.setState({ ...this.state, screen });
  }
}
