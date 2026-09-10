export type Row = Record<string, string>;

export interface SnapshotData {
  /**
   * The id of the People row the token in this gateway belongs to. `people` carries no
   * tokens, so this is the only way a device learns which row is its own.
   *
   * Optional because a deployment older than the server change that added it does not
   * send one, and the app still has to boot against it.
   */
  readonly me?: string;
  /** The household zone from the `Meta` tab. Optional for the same reason as `me`. */
  readonly timeZone?: string;
  readonly people: Row[];
  readonly assets: Row[];
  readonly chores: Row[];
  readonly instances: Row[];
  readonly completions: Row[];
}

export interface Envelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly serverTime: string;
  readonly version: number;
}

export interface Gateway {
  post<T>(op: string, payload: unknown, mutationId: string): Promise<Envelope<T>>;
  snapshot(): Promise<Envelope<SnapshotData>>;
}

/**
 * A transport failure: non-2xx status, a network throw, or a body that is not JSON.
 * An `{ok:false}` envelope is a normal server answer and is returned as a value, never
 * thrown as this.
 */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

/**
 * The only file in this app that calls `fetch`. The body is `text/plain` holding
 * JSON: `application/json` would trigger a CORS preflight Apps Script cannot answer.
 * Never logs the token.
 */
export class SheetsGateway implements Gateway {
  readonly #execUrl: string;
  readonly #token: string;

  constructor(execUrl: string, token: string) {
    this.#execUrl = execUrl;
    this.#token = token;
  }

  async post<T>(op: string, payload: unknown, mutationId: string): Promise<Envelope<T>> {
    let response: Response;
    try {
      response = await fetch(this.#execUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: this.#token, op, payload, mutationId }),
      });
    } catch {
      throw new TransportError(`network request failed for op "${op}"`);
    }

    if (!response.ok) {
      throw new TransportError(`non-2xx status ${String(response.status)} for op "${op}"`);
    }

    try {
      return (await response.json()) as Envelope<T>;
    } catch {
      throw new TransportError(`response body was not JSON for op "${op}"`);
    }
  }

  snapshot(): Promise<Envelope<SnapshotData>> {
    return this.post<SnapshotData>("snapshot", {}, "");
  }
}
