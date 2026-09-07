import type { Page, Route } from "@playwright/test";

/**
 * A thin stand-in for the deployed Apps Script backend. It routes the one fake exec
 * URL, records every request it sees, and replies with whatever envelope the spec
 * supplies (via `handler`) or a bland default. It must never decide anything a spec is
 * supposed to be proving: no weight/health/fairness arithmetic, no persistence beyond
 * what a test explicitly asks for by mutating `snapshot` or returning a `handler` body.
 */

export const EXEC_URL = "https://script.google.com/macros/s/e2e-fake-not-a-real-deployment/exec";
export const TOKEN = "e2e-token";

/** A sheet row. Every cell is a string, matching the real Sheets wire format. */
export type Row = Record<string, string>;

export interface SnapshotData {
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

/** Cells arrive as strings over the wire, so an unknown-valued bag is the honest type. */
export type Payload = Readonly<Record<string, unknown>>;

export interface Recorded {
  readonly op: string;
  readonly payload: Payload;
  readonly mutationId: string;
}

export interface FakeServer {
  readonly recorded: Recorded[];
  /** Rows the next `snapshot` will return. Mutate between calls to simulate the server. */
  snapshot: SnapshotData;
  version: number;
  /** Per-op override. Return null to fall through to the default behaviour. */
  handler: ((r: Recorded) => { status?: number; body?: unknown } | null) | null;
  /** Every request fails at the transport layer (route.abort), not with an error envelope. */
  offline: boolean;
  /** Artificial delay, in ms, before a response (of any kind) is sent. */
  latencyMs: number;
}

function emptySnapshot(): SnapshotData {
  return { people: [], assets: [], chores: [], instances: [], completions: [] };
}

const KNOWN_OPS_WITH_BLAND_DEFAULT = new Set([
  "complete",
  "chore.create",
  "chore.update",
  "chore.delete",
  "household.seed",
]);

/** The response used when a spec has not supplied a `handler` override for this op. */
function defaultEnvelope(op: string, server: FakeServer, serverTime: string): Envelope<unknown> {
  if (op === "snapshot") {
    return { ok: true, data: server.snapshot, serverTime, version: server.version };
  }
  if (KNOWN_OPS_WITH_BLAND_DEFAULT.has(op)) {
    // A bland, content-free success. Specs that need the response to carry anything
    // meaningful (an assigned id, an echoed row) supply their own `handler`.
    return { ok: true, data: {}, serverTime, version: server.version };
  }
  return { ok: false, error: `fakeServer: no default behaviour for op "${op}"`, serverTime, version: server.version };
}

interface RequestEnvelope {
  readonly token?: unknown;
  readonly op?: unknown;
  readonly payload?: unknown;
  readonly mutationId?: unknown;
}

function parseBody(route: Route): RequestEnvelope {
  try {
    const text = route.request().postData() ?? "{}";
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? (parsed as RequestEnvelope) : {};
  } catch {
    return {};
  }
}

function asPayload(value: unknown): Payload {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Payload)
    : {};
}

/**
 * Installs the route for the fake exec URL on `page` and returns the live `FakeServer`
 * handle. The returned object is the same one the route reads from on every request, so
 * a spec can mutate `snapshot`, `offline`, `latencyMs` or `handler` at any point and the
 * next request will see the change.
 */
export async function installFakeServer(page: Page, initial?: Partial<FakeServer>): Promise<FakeServer> {
  const server: FakeServer = {
    recorded: [],
    snapshot: initial?.snapshot ?? emptySnapshot(),
    version: initial?.version ?? 1,
    handler: initial?.handler ?? null,
    offline: initial?.offline ?? false,
    latencyMs: initial?.latencyMs ?? 0,
  };

  await page.route(EXEC_URL, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    if (server.offline) {
      // A transport-layer failure. The request never reaches the "server": it is not
      // recorded, and the app must see this as a throw, not as an {ok:false} envelope.
      await route.abort("failed");
      return;
    }

    const body = parseBody(route);
    const recorded: Recorded = {
      op: String(body.op ?? ""),
      payload: asPayload(body.payload),
      mutationId: String(body.mutationId ?? ""),
    };
    server.recorded.push(recorded);

    if (server.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, server.latencyMs));
    }

    const serverTime = new Date().toISOString();
    const override = server.handler ? server.handler(recorded) : null;

    if (override) {
      await route.fulfill({
        status: override.status ?? 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(override.body ?? { ok: true, data: {}, serverTime, version: server.version }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(defaultEnvelope(recorded.op, server, serverTime)),
    });
  });

  return server;
}

/** Writes credentials into localStorage before the app boots. */
export async function seedCredentials(page: Page, personId = "p1"): Promise<void> {
  await page.addInitScript(
    ({ execUrl, token, personId }: { execUrl: string; token: string; personId: string }) => {
      window.localStorage.setItem("house.credentials", JSON.stringify({ execUrl, token, personId }));
    },
    { execUrl: EXEC_URL, token: TOKEN, personId }
  );
}
