import { Presenter } from "../app/Presenter.js";
import { saveCredentials, type Credentials } from "../app/credentials.js";
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

export class SetupPresenter extends Presenter<SetupViewState> {
  readonly #deps: SetupPresenterDeps;

  constructor(deps: SetupPresenterDeps) {
    super({
      execUrl: "",
      token: "",
      stage: "credentials",
      people: [],
      selectedPersonId: "",
      busy: false,
      error: null,
    });
    this.#deps = deps;
  }

  setExecUrl(v: string): void {
    this.setState({ ...this.state, execUrl: v, error: null });
  }

  setToken(v: string): void {
    this.setState({ ...this.state, token: v, error: null });
  }

  /** Probes `snapshot`; on ok -> stage "person". Never echoes the token back. */
  async submitCredentials(): Promise<void> {
    const execUrl = this.state.execUrl.trim();
    const token = this.state.token;
    if (execUrl === "" || token === "") {
      this.setState({ ...this.state, error: "Enter both the script URL and the token." });
      return;
    }

    this.setState({ ...this.state, busy: true, error: null });
    const gateway = this.#deps.makeGateway(execUrl, token);
    try {
      const envelope = await gateway.snapshot();
      if (!envelope.ok || envelope.data === undefined) {
        this.setState({
          ...this.state,
          busy: false,
          error: "That token was refused. Check it against the People tab and try again.",
        });
        return;
      }
      const people: SetupPerson[] = envelope.data.people
        .map((row) => ({ id: String(row["id"] ?? ""), displayName: String(row["displayName"] ?? "") }))
        .filter((p) => p.id !== "");
      this.setState({
        ...this.state,
        busy: false,
        stage: "person",
        people,
        selectedPersonId: "",
        error: null,
      });
    } catch {
      this.setState({
        ...this.state,
        busy: false,
        error: "Could not reach that script URL. Check it and your connection, then try again.",
      });
    }
  }

  selectPerson(id: string): void {
    this.setState({ ...this.state, selectedPersonId: id });
  }

  /** Saves credentials, calls onReady. */
  confirmPerson(): void {
    if (this.state.selectedPersonId === "") return;
    const credentials: Credentials = {
      execUrl: this.state.execUrl.trim(),
      token: this.state.token,
      personId: this.state.selectedPersonId,
    };
    saveCredentials(this.#deps.store, credentials);
    this.#deps.onReady(credentials);
  }
}
