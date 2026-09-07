// STUB - phase 3. Nothing is actually written to IndexedDB yet: `enqueue` mints a real
// mutationId (that part is load-bearing, see the contract's non-negotiable 5) but does
// not persist it, and every other method resolves without doing anything real. A flush
// that is supposed to send queued mutations sends none, so a test asserting the queue
// drained after a flush fails on that assertion rather than on a missing method.
import type { Gateway } from "../gateway/SheetsGateway.js";

export interface QueuedMutation {
  readonly seq: number;
  readonly mutationId: string;
  readonly op: string;
  readonly payload: unknown;
  readonly enqueuedAt: number;
}

export interface FlushOutcome {
  readonly sent: number;
  readonly halted: boolean;
  readonly error: string | null;
}

export class MutationQueue {
  readonly #newId: () => string;
  readonly #now: () => number;

  constructor(factory: IDBFactory, newId: () => string, now: () => number, dbName = "house-queue") {
    void factory;
    void dbName;
    this.#newId = newId;
    this.#now = now;
  }

  async enqueue(op: string, payload: unknown): Promise<QueuedMutation> {
    return {
      seq: NaN,
      mutationId: this.#newId(),
      op,
      payload,
      enqueuedAt: this.#now(),
    };
  }

  async list(): Promise<QueuedMutation[]> {
    return [{ seq: NaN, mutationId: "stub-mutation", op: "stub", payload: null, enqueuedAt: NaN }];
  }

  async pendingMutationIds(): Promise<Set<string>> {
    return new Set(["stub-mutation"]);
  }

  async size(): Promise<number> {
    return NaN;
  }

  async flush(gateway: Gateway): Promise<FlushOutcome> {
    void gateway;
    return { sent: NaN, halted: false, error: null };
  }
}
