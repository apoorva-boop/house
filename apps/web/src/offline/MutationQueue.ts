// The durable, ordered overlay on top of the last server snapshot. IndexedDB rather than
// localStorage because a queued mutation must survive the reload flow 7 exercises, and
// localStorage's synchronous API would block the tick it is supposed to make instant.
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

const STORE_NAME = "mutations";
const DB_VERSION = 1;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * `mutationId` is minted here, in `enqueue`, and nowhere else. The server dedupes on it,
 * so a retry of a failed send must carry the exact same id — minting a fresh one at POST
 * time would write a second `Completions` row for one tick.
 */
export class MutationQueue {
  readonly #factory: IDBFactory;
  readonly #newId: () => string;
  readonly #now: () => number;
  readonly #dbName: string;
  #dbPromise: Promise<IDBDatabase> | null = null;
  #flushing = false;

  constructor(factory: IDBFactory, newId: () => string, now: () => number, dbName = "house-queue") {
    this.#factory = factory;
    this.#newId = newId;
    this.#now = now;
    this.#dbName = dbName;
  }

  #openDb(): Promise<IDBDatabase> {
    if (this.#dbPromise === null) {
      this.#dbPromise = new Promise((resolve, reject) => {
        const request = this.#factory.open(this.#dbName, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "seq", autoIncrement: true });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`failed to open "${this.#dbName}"`));
      });
    }
    return this.#dbPromise;
  }

  async #transaction(mode: IDBTransactionMode): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
    const db = await this.#openDb();
    const tx = db.transaction(STORE_NAME, mode);
    return { store: tx.objectStore(STORE_NAME), tx };
  }

  async enqueue(op: string, payload: unknown): Promise<QueuedMutation> {
    const { store, tx } = await this.#transaction("readwrite");
    const withoutSeq = {
      mutationId: this.#newId(),
      op,
      payload,
      enqueuedAt: this.#now(),
    };
    const seq = await requestToPromise(store.add(withoutSeq));
    await txDone(tx);
    return { seq: seq as number, ...withoutSeq };
  }

  /** Ascending by `seq` — strict FIFO order. */
  async list(): Promise<QueuedMutation[]> {
    const { store, tx } = await this.#transaction("readonly");
    const all = await requestToPromise(store.getAll());
    await txDone(tx);
    return (all as QueuedMutation[]).slice().sort((a, b) => a.seq - b.seq);
  }

  async pendingMutationIds(): Promise<Set<string>> {
    const all = await this.list();
    return new Set(all.map((entry) => entry.mutationId));
  }

  async size(): Promise<number> {
    const { store, tx } = await this.#transaction("readonly");
    const count = await requestToPromise(store.count());
    await txDone(tx);
    return count;
  }

  async #deleteEntry(seq: number): Promise<void> {
    const { store, tx } = await this.#transaction("readwrite");
    store.delete(seq);
    await txDone(tx);
  }

  /**
   * Sends the queue in strict FIFO order, one at a time, deleting each entry only after
   * the server answers `ok: true`. Halts on the first `TransportError` or `{ok:false}`
   * and leaves that entry and everything after it in the store — a rejected mutation
   * wedges the queue visibly rather than the app silently dropping it or skipping ahead.
   *
   * Re-entrant-safe: `tick()` fires this in the background on every tap, so a second
   * call while one is already running is the normal case, not an edge case. It returns
   * `{sent: 0, halted: false, error: null}` immediately rather than sending anything a
   * second time.
   */
  async flush(gateway: Gateway): Promise<FlushOutcome> {
    if (this.#flushing) {
      return { sent: 0, halted: false, error: null };
    }
    this.#flushing = true;
    try {
      const pending = await this.list();
      let sent = 0;
      for (const entry of pending) {
        let envelope;
        try {
          envelope = await gateway.post(entry.op, entry.payload, entry.mutationId);
        } catch (err) {
          const message = err instanceof Error ? err.message : "the network request failed";
          return { sent, halted: true, error: message };
        }
        if (!envelope.ok) {
          return { sent, halted: true, error: envelope.error ?? "the server refused this change" };
        }
        await this.#deleteEntry(entry.seq);
        sent += 1;
      }
      return { sent, halted: false, error: null };
    } finally {
      this.#flushing = false;
    }
  }
}
