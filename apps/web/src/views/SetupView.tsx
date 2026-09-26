import { useSyncExternalStore } from "react";
import type { SetupPresenter } from "../presenters/SetupPresenter.js";

export function SetupView({ presenter }: { presenter: SetupPresenter }) {
  const state = useSyncExternalStore(presenter.subscribe, presenter.snapshot);

  return (
    <div className="setup-screen" data-testid="setup-screen">
      <h1>Set up this device</h1>

      <section aria-label="Credentials">
        <label>
          Script URL
          <input
            type="text"
            data-testid="setup-exec-url"
            value={state.execUrl}
            onChange={(e) => {
              presenter.setExecUrl(e.target.value);
            }}
          />
        </label>
        <label>
          Token
          <input
            type="password"
            data-testid="setup-token"
            value={state.token}
            onChange={(e) => {
              presenter.setToken(e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          data-testid="setup-submit"
          aria-disabled={state.busy}
          onClick={() => {
            if (state.busy) return;
            void presenter.submitCredentials();
          }}
        >
          Continue
        </button>
        {state.error !== null && (
          <p className="setup-error" data-testid="setup-error" role="alert">
            {state.error}
          </p>
        )}
      </section>
    </div>
  );
}
