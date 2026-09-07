// STUB - phase 3. `submitCredentials` never probes the gateway and `confirmPerson`
// never calls `onReady`, so a test that fills in the form and clicks through finds
// every control but nothing happens after — it fails on the assertion that the app
// moved on, not because a field or button is missing.
import { Presenter } from "../app/Presenter.js";
import type { Credentials } from "../app/credentials.js";
import type { Gateway } from "../gateway/SheetsGateway.js";

export interface SetupPerson {
  readonly id: string;
  readonly displayName: string;
}

export interface SetupViewState {
  readonly execUrl: string;
  readonly token: string;
  readonly stage: "credentials" | "person";
  readonly people: readonly SetupPerson[];
  readonly selectedPersonId: string;
  readonly busy: boolean;
  readonly error: string | null;
}

export interface SetupPresenterDeps {
  readonly makeGateway: (execUrl: string, token: string) => Gateway;
  readonly store: Storage;
  readonly onReady: (c: Credentials) => void;
}

const STUB_PEOPLE: SetupPerson[] = [
  { id: "stub-person-1", displayName: "Stub person one" },
  { id: "stub-person-2", displayName: "Stub person two" },
];

export class SetupPresenter extends Presenter<SetupViewState> {
  readonly #deps: SetupPresenterDeps;

  constructor(deps: SetupPresenterDeps) {
    super({
      execUrl: "",
      token: "",
      // The stub view renders both stages' markup regardless of `stage`, so
      // `setup-person-option` is always in the DOM — see SetupView.tsx.
      stage: "credentials",
      people: STUB_PEOPLE,
      selectedPersonId: "",
      busy: false,
      error: null,
    });
    this.#deps = deps;
  }

  setExecUrl(v: string): void {
    this.setState({ ...this.state, execUrl: v });
  }

  setToken(v: string): void {
    this.setState({ ...this.state, token: v });
  }

  /** Probes `snapshot`; on ok -> stage "person". Not wired up yet. */
  async submitCredentials(): Promise<void> {
    void this.#deps.makeGateway;
  }

  selectPerson(id: string): void {
    this.setState({ ...this.state, selectedPersonId: id });
  }

  /** Saves credentials, calls onReady. Not wired up yet. */
  confirmPerson(): void {
    void this.#deps.store;
    void this.#deps.onReady;
  }
}
