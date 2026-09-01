// ===========================================================================
// DELIBERATE STUB. NOT AN IMPLEMENTATION. DO NOT BUILD ON IT.
// ===========================================================================
//
// This file exists so the 21 integration tests in `apps-script/src/*.test.ts`
// can fail on their ASSERTIONS instead of dying in `beforeAll` because there is
// no endpoint to talk to. A suite that cannot reach its backend is broken, not
// red, and a broken suite proves nothing about the code that replaces this file.
//
// So this endpoint is deliberately WELL-FORMED and deliberately WRONG:
//   - it accepts the real transport (POST, `text/plain` body holding JSON),
//   - it parses the real envelope (`{token, op, payload, mutationId}`),
//   - it answers with the real response shape (`{ok, data, serverTime, version}`)
//     and the real MIME type,
//   - and it does NOTHING ELSE. No token check, no sheet read, no sheet write,
//     no `getScriptLock()`, no `mutationId` dedupe, no server-side points, no
//     calendar event, no DueSweep.
//
// Every op therefore returns `ok: true` with an empty `data`, which is the wrong
// answer for all 21 tests. That is the point.
//
// WHAT REPLACES THIS FILE (plan section 3, `apps-script`):
//   src/doPost.ts          envelope validation, token check, `getScriptLock()`,
//                          `mutationId` dedupe then `instanceId` uniqueness,
//                          server-computed `pointsAwarded` inside the lock
//   src/doGet.ts           snapshot with real `version` and `serverTime`
//   src/DueSweep.ts        sole owner of instance materialisation; `sweep.run`
//   src/CalendarChannel.ts create/update/delete, tagging every event with
//                          `extendedProperties.private.instanceId`
//   plus the `test.*` support ops, which authenticate against the Script
//   Property `TEST_TOKEN` rather than against a People row.
//
// Anyone implementing the above should DELETE the stub response below rather
// than extend it. If the tests are still green against this file, they are not
// testing anything.
//
// ---------------------------------------------------------------------------
// Apps Script shape notes
// ---------------------------------------------------------------------------
// `doPost` and `doGet` must be TOP-LEVEL FUNCTION DECLARATIONS, which is what
// makes them globals in the V8 runtime. They are NOT ES module exports: Apps
// Script has no module system. `scripts/build-appsscript.mjs` transpiles this
// file with esbuild's `transform` (not `bundle`), so nothing wraps it in an IIFE
// and nothing rewrites it into `import`/`export`/`require`.
//
// The domain rules arrive separately as `globalThis.Domain`, from
// `apps-script/build/domain.js` (`pnpm build:domain`). The stub does not use
// them; the real implementation will.

// --- Ambient declarations --------------------------------------------------
// `ContentService` and the rest of the Apps Script globals come from
// `@types/google-apps-script`, wired in via `types` in `apps-script/tsconfig.json`.
// That package is types-only: it emits nothing, so the deployed `.gs` is unchanged.
// `GoogleAppsScript` is an ambient namespace, NOT an import — referencing it keeps
// this file a script rather than turning it into a module, which is what lets Apps
// Script see `doPost`/`doGet` as globals.

/** The `e` Apps Script hands a web app. Only `postData.contents` matters here. */
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

/**
 * The stub answer. Well-formed envelope, wrong content: `ok` is unconditionally
 * true and `data` is unconditionally empty, whatever the op was.
 */
function stubEnvelope_(): string {
  return JSON.stringify({
    ok: true,
    data: {},
    serverTime: new Date().toISOString(),
    version: 0,
  });
}

function jsonOutput_(body: string): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e: WebAppEvent): GoogleAppsScript.Content.TextOutput {
  // Parsed so a malformed body cannot 500 and turn an assertion failure into a
  // transport failure. The parsed value is deliberately discarded — routing on
  // `op` is the next agent's job.
  parseRequest_(e);
  return jsonOutput_(stubEnvelope_());
}

function doGet(e: WebAppEvent): GoogleAppsScript.Content.TextOutput {
  parseRequest_(e);
  return jsonOutput_(stubEnvelope_());
}

// Apps Script calls these; nothing in this repo does. A top-level `function` in a
// `.gs` file is already a global, so these two lines change nothing at runtime —
// they state the contract, mirror `globalThis.Domain = Domain` in the domain
// bundle, and stop the linter reporting the platform's entry points as dead code.
globalThis.doPost = doPost;
globalThis.doGet = doGet;
