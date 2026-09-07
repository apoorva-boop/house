// STUB - phase 3. Renders both stages' markup unconditionally instead of gating on
// `state.stage`, so `setup-exec-url`/`setup-token`/`setup-submit` and
// `setup-person-option` all exist from the first render. The real implementation
// shows one stage at a time.
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
          onClick={() => {
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

      <section aria-label="Who are you">
        <fieldset>
          <legend>Who are you?</legend>
          {state.people.map((person) => (
            <label
              key={person.id}
              className="setup-person-option"
              data-testid="setup-person-option"
              data-person-id={person.id}
            >
              <input
                type="radio"
                name="setup-person"
                value={person.id}
                checked={state.selectedPersonId === person.id}
                onChange={() => {
                  presenter.selectPerson(person.id);
                }}
              />
              {person.displayName}
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          data-testid="setup-person-confirm"
          onClick={() => {
            presenter.confirmPerson();
          }}
        >
          Confirm
        </button>
      </section>
    </div>
  );
}
