import { Presenter } from "../app/Presenter.js";
import { saveCredentials, type Credentials } from "../app/credentials.js";
import type { Gateway } from "../gateway/SheetsGateway.js";

export interface SetupViewState {
  readonly execUrl: string;
  readonly token: string;
  readonly busy: boolean;
  readonly error: string | null;
}

export interface SetupPresenterDeps {
  readonly makeGateway: (execUrl: string, token: string) => Gateway;
  readonly store: Storage;
  readonly onReady: (c: Credentials) => void;
}

/**
 * Setup is one stage: the script URL and the token, and nothing else.
 *
 * It used to ask "who are you?" afterwards and make you pick yourself off a list. That
 * question was never a real one — the token already answers it, and the server has known
 * the answer since the first request. The list existed only because the snapshot did not
 * report `me`, so the app could not read the answer it had already been given, and
 * letting the household choose meant a mistap silently attributed everything to the
 * wrong person for as long as nobody noticed.
 *
 * The probe below is what replaces it. It still proves the URL and the token, and it now
 * also proves the token resolves to somebody.
 */
export class SetupPresenter extends Presenter<SetupViewState> {
  readonly #deps: SetupPresenterDeps;

  constructor(deps: SetupPresenterDeps) {
    super({ execUrl: "", token: "", busy: false, error: null });
    this.#deps = deps;
  }

  setExecUrl(v: string): void {
    this.setState({ ...this.state, execUrl: v, error: null });
  }

  setToken(v: string): void {
    this.setState({ ...this.state, token: v, error: null });
  }

  /**
   * Probes `snapshot`; on success saves the credentials and hands them to `onReady`.
   * Never echoes the token back into an error message.
   */
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
      // The token is valid but belongs to nobody. On a current deployment that means the
      // People row it came from has gone; on an older one it means the server predates
      // `me` and cannot say. Either way the app would run without knowing whose taps
      // these are, which is worse than refusing here where it can still be fixed.
      if ((envelope.data.me ?? "") === "") {
        this.setState({
          ...this.state,
          busy: false,
          error:
            "That script accepted the token but did not say who it belongs to. " +
            "Check the token has a row in the People tab, and that the script is up to date.",
        });
        return;
      }
      const credentials: Credentials = { execUrl, token };
      saveCredentials(this.#deps.store, credentials);
      this.setState({ ...this.state, busy: false, error: null });
      this.#deps.onReady(credentials);
    } catch {
      this.setState({
        ...this.state,
        busy: false,
        error: "Could not reach that script URL. Check it and your connection, then try again.",
      });
    }
  }
}
