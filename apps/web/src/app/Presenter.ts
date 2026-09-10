export type Unsubscribe = () => void;

/**
 * Observable view state. No DOM, no React: views subscribe with
 * `useSyncExternalStore`. Every concrete presenter is a plain TypeScript class so it
 * has no dependency on the framework a native port would replace.
 */
export abstract class Presenter<S> {
  #state: S;
  #listeners = new Set<() => void>();

  constructor(initial: S) {
    this.#state = initial;
  }

  get state(): S {
    return this.#state;
  }

  /** Stable identity between changes, so `useSyncExternalStore` does not loop. */
  readonly snapshot = (): S => this.#state;

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  protected setState(next: S): void {
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}
