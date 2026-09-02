// The web app's entry points and op router.
//
// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------
// `doPost` and `doGet` must be TOP-LEVEL FUNCTION DECLARATIONS, which is what makes them
// globals in the V8 runtime. They are NOT ES module exports: Apps Script has no module
// system. `scripts/build-appsscript.mjs` transpiles every file in `apps-script/src` with
// esbuild's `transform` (not `bundle`), so nothing wraps them in an IIFE and nothing
// rewrites them into `import`/`export`/`require`. Every sibling file here is a script
// too, and they all share one global scope — that is how `opComplete_`, `runDueSweep_`
// and the rest are visible from this file with no import.
//
// The domain rules arrive separately as `globalThis.Domain`, from
// `apps-script/build/domain.js` (`pnpm build:domain`), and are declared in `Config.ts`.
//
// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
// The body arrives as `text/plain` holding JSON. That is not laziness: Apps Script
// cannot answer a CORS preflight, and `application/json` makes the browser preflight and
// fail. `text/plain` keeps the request "simple", so the PWA can post to it at all.
//
// Every response is HTTP 200 with `{ok, data, serverTime, version}` or
// `{ok: false, error}`. Apps Script has no way to set a status code on a web app
// response anyway, and a client that has to distinguish "the server said no" from "the
// request never arrived" needs a parseable body either way. `data` is OMITTED on
// failure — a client must not find a half-shaped payload sitting under an `ok: false`.
//
// NOTHING throws out of `doPost`. An uncaught exception renders Google's HTML error
// page, which the client cannot parse and which reports as a transport failure rather
// than the server error it is.

/** The `e` Apps Script hands a web app. Only `postData.contents` matters for POST. */
interface WebAppEvent {
  postData?: { contents?: string; type?: string };
  parameter?: Record<string, string>;
}

/** The request envelope the client and the test suite both send. */
interface RequestEnvelope {
  token?: string;
  op?: string;
  payload?: unknown;
  mutationId?: string;
}

/**
 * Parses the `text/plain` body as JSON. Trailing underscore is the Apps Script
 * convention for "private", which keeps it out of the editor's Run menu.
 */
function parseRequest_(e: WebAppEvent | undefined): RequestEnvelope {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : "";
  if (raw === "") return {};
  try {
    return JSON.parse(raw) as RequestEnvelope;
  } catch {
    return {};
  }
}

function asPayload_(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function jsonOutput_(body: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function okEnvelope_(data: unknown): GoogleAppsScript.Content.TextOutput {
  return jsonOutput_({
    ok: true,
    data,
    serverTime: toIso_(Date.now()),
    version: currentVersion_(),
  });
}

/** No `data` key at all, so a client cannot read a half-shaped payload off a failure. */
function errorEnvelope_(message: string): GoogleAppsScript.Content.TextOutput {
  return jsonOutput_({
    ok: false,
    error: message === "" ? "Request failed." : message,
    serverTime: toIso_(Date.now()),
    version: currentVersion_(),
  });
}

function messageOf_(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Routes one authenticated op.
 *
 * Authentication happens in `handleRequest_` BEFORE this is reached, and before any op
 * has touched a row. A token check that runs after the write is not a check.
 */
function dispatch_(
  identity: Identity,
  op: string,
  payload: Record<string, unknown>,
  mutationId: string,
): unknown {
  switch (op) {
    case "complete":
      return opComplete_(identity, payload, mutationId);
    case "household.seed":
      return opHouseholdSeed_();
    case "chore.create":
      return opChoreCreate_(payload);
    case "chore.update":
      return opChoreUpdate_(payload);
    case "chore.delete":
      return opChoreDelete_(payload);
    case "sweep.run":
      return opSweepRun_(payload);
    case "calendar.reconcile":
      return opCalendarReconcile_(payload);
    case "snapshot":
      return opSnapshot_();

    // The test-support namespace. `authenticate_` has already refused every one of these
    // unless TEST_MODE is "true" AND the token is TEST_TOKEN, so reaching this point is
    // itself the authorisation.
    case "test.clear":
      return opTestClear_();
    case "test.read":
      return opTestRead_(payload);
    case "test.write":
      return opTestWrite_(payload);
    case "test.update":
      return opTestUpdate_(payload);
    case "test.calendar.list":
      return opTestCalendarList_(payload);
    case "test.calendar.create":
      return opTestCalendarCreate_(payload);

    default:
      throw new Error(`Unknown op "${op}".`);
  }
}

function handleRequest_(envelope: RequestEnvelope): GoogleAppsScript.Content.TextOutput {
  try {
    // Before anything else, including auth. `Config.ts` type-checks this server against
    // an ambient `Domain` that emits nothing, so a bundle that does not match is a
    // silent wrong answer rather than a crash — see `assertDomainBundleFresh_`. Refusing
    // the request is the loud version. The catch below turns it into an error envelope.
    assertDomainBundleFresh_();

    const op = asText_(envelope.op);
    const token = asText_(envelope.token);
    const outcome = authenticate_(token, op);
    if (outcome.identity === null) return errorEnvelope_(outcome.error);

    return okEnvelope_(
      dispatch_(outcome.identity, op, asPayload_(envelope.payload), asText_(envelope.mutationId)),
    );
  } catch (error) {
    return errorEnvelope_(messageOf_(error));
  }
}

function doPost(e: WebAppEvent): GoogleAppsScript.Content.TextOutput {
  try {
    return handleRequest_(parseRequest_(e));
  } catch (error) {
    // Belt and braces. Even a failure inside the error path must come back as JSON.
    return errorEnvelope_(messageOf_(error));
  }
}

/**
 * `snapshot`, and nothing else, so a browser can read the household without a body.
 *
 * ONE op, deliberately. This used to route the whole `dispatch_` table off query
 * parameters, which put `complete`, `chore.delete` and `test.clear` — the op that wipes
 * every tab — on a URL, next to the token that authorises them. A token in a URL is a
 * token in the browser's history, in the `Referer` header of anything that page links to,
 * and in Google's own execution log; a mutation in a URL is a mutation a link, a prefetch
 * or a crawler can fire. Every mutating op is a POST, where the token travels in the body.
 *
 * `payload` and `mutationId` are gone with it: `snapshot` takes neither.
 */
function doGet(e: WebAppEvent): GoogleAppsScript.Content.TextOutput {
  try {
    const parameter = e && e.parameter ? e.parameter : {};
    const op = asText_(parameter["op"]);
    if (op !== "" && op !== "snapshot") {
      return errorEnvelope_(
        `GET serves "snapshot" only, and this asked for "${op}". Send it as a POST: ` +
          "every other op mutates, and a URL is the one place a token must never travel.",
      );
    }
    return handleRequest_({ token: asText_(parameter["token"]), op: "snapshot" });
  } catch (error) {
    return errorEnvelope_(messageOf_(error));
  }
}

// Apps Script calls these; nothing in this repo does. A top-level `function` in a
// `.gs` file is already a global, so these lines change nothing at runtime — they state
// the contract, mirror `globalThis.Domain = Domain` in the domain bundle, and stop the
// linter reporting the platform's entry points as dead code.
globalThis.doPost = doPost;
globalThis.doGet = doGet;
