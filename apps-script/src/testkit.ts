// Test infrastructure for the Apps Script integration suite. NOT implementation.
//
// These tests talk to a REAL disposable Google Sheet and a REAL throwaway Google
// Calendar through the deployed Apps Script web app. Mocks prove nothing here: the
// risk this suite exists to catch is real concurrency against a real spreadsheet.
//
// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
// Read from `.env` at the repo root (gitignored — the repo is public, so no ID,
// URL or token is ever committed). Nothing here is hardcoded.
//
//   SHEETS_TEST_ID           the disposable spreadsheet
//   CALENDAR_TEST_ID         the throwaway calendar
//   APPS_SCRIPT_EXEC_URL     the deployed /exec URL of the web app
//   APPS_SCRIPT_TEST_TOKEN   the test-support token (see "Test-support ops")
//
// If any is missing the suite FAILS with a message naming it. It does not skip.
// A suite that goes green because its backend is absent proves nothing, and that
// is the exact failure mode the testing plan calls out.
//
// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
// POST to {execUrl} with `Content-Type: text/plain;charset=utf-8` and a body that
// is JSON *text*. Apps Script cannot answer a CORS preflight, so `application/json`
// makes the browser preflight and fail; the production client uses text/plain too,
// and the tests must exercise the same path. Apps Script answers 200 after a 302
// hop to googleusercontent.com, which `fetch` follows by default.
//
// Envelope: {token, op, payload, mutationId} -> {ok, data, error, serverTime, version}
//
// `postEnvelope` retries TRANSPORT failures and nothing else — see its docstring. A
// well-formed envelope is the server's answer and is handed back untouched, `ok: false`
// very much included.
//
// ---------------------------------------------------------------------------
// Ops these tests require
// ---------------------------------------------------------------------------
// Production ops (the real contract):
//   complete            {instanceId, choreId, personId, completedAt, pointsAwarded?}
//   chore.create        a Chore row
//   chore.update        {id, ...fields}
//   chore.delete        {id}
//   sweep.run           {now} — runs DueSweep as of that instant. Tests cannot wait
//                       for a time-driven trigger, so the sweep must be callable.
//                       Returns {created:[instanceId], notified:[instanceId]}.
//   calendar.reconcile  {now} — sweeps tagged calendar events with no live instance.
//
// Test-support ops. These are a deliberate, minimal backdoor for the suite. They
// authenticate against the Script Property `TEST_TOKEN` (whose value is
// APPS_SCRIPT_TEST_TOKEN), NOT against a People row — so the backdoor is separable
// from person auth and can be switched off in a real deployment:
//   test.clear            wipe every data tab and delete every event on the calendar
//   test.reset            {tabs: {TabName: Row[]}} — wipe, then seed, in ONE request.
//                         `clearAll()` + `seedHousehold()` is four round trips and every
//                         one of the thirty tests pays for it in `beforeEach`; this is one.
//   test.read             {tab} -> {rows: object[]} keyed by header name
//   test.write            {tab, rows} -> append rows keyed by header name
//   test.update           {tab, keyField, rows} -> overwrite rows matched on keyField
//   test.calendar.list    {timeMin, timeMax} -> [{eventId, instanceId, title, startAt}]
//                         `instanceId` read from extendedProperties.private.instanceId
//   test.calendar.create  {instanceId, title, startAt} -> {eventId}
//                         creates a TAGGED event directly, so the orphan-reconcile
//                         test can manufacture the post-crash state.
//
// ---------------------------------------------------------------------------
// Sheet schema used by these tests
// ---------------------------------------------------------------------------
// All timestamps are ISO-8601-with-offset TEXT, never Sheets date cells, which
// coerce to the spreadsheet's own zone.

import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Column headers per tab. One place, so a schema change is a one-line edit. */
export const SCHEMA = {
  People: ["id", "displayName", "token"],
  Assets: ["id", "kind", "budget"],
  Chores: [
    "id",
    "title",
    "assetId",
    "weightTime",
    "weightEffort",
    "weightPriority",
    "recurrenceUnit",
    "recurrenceN",
    "nextDueAt",
    "deadlineDate",
    "leadTimeDays",
    "deletedAt",
  ],
  Instances: ["instanceId", "choreId", "dueAt", "calendarEventId", "lastNotifiedAt", "snoozedUntil"],
  Completions: [
    "mutationId",
    "instanceId",
    "personId",
    "choreId",
    "completedAt",
    "pointsAwarded",
    "choreTitle",
    "assetId",
  ],
  Meta: ["key", "value"],
} as const;

export type TabName = keyof typeof SCHEMA;
export type Row = Record<string, string | number>;

export interface Envelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  serverTime?: string;
  version?: string;
}

export interface CalendarEvent {
  eventId: string;
  instanceId: string;
  title?: string;
  startAt?: string;
}

// ---------------------------------------------------------------------------
// .env loading — no `export FOO=` by hand, and no new dependency.
// ---------------------------------------------------------------------------

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let dotEnvCache: Record<string, string> | null = null;

function dotEnv(): Record<string, string> {
  if (dotEnvCache) return dotEnvCache;
  const path = join(repoRoot(), ".env");
  dotEnvCache = existsSync(path) ? parseDotEnv(readFileSync(path, "utf8")) : {};
  return dotEnvCache;
}

/** Real process env wins over `.env`, so CI can override without a file. */
function envVar(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== "") return fromProcess;
  const fromFile = dotEnv()[name];
  return fromFile !== undefined && fromFile !== "" ? fromFile : undefined;
}

export const REQUIRED_ENV = [
  "SHEETS_TEST_ID",
  "CALENDAR_TEST_ID",
  "APPS_SCRIPT_EXEC_URL",
  "APPS_SCRIPT_TEST_TOKEN",
] as const;

export interface IntegrationEnv {
  sheetsTestId: string;
  calendarTestId: string;
  execUrl: string;
  testToken: string;
}

/**
 * Throws — never skips — naming every missing variable. Call from `beforeAll`.
 * A missing backend must be loud: a green suite with no backend proves nothing.
 */
export function requireIntegrationEnv(): IntegrationEnv {
  const missing = REQUIRED_ENV.filter((name) => envVar(name) === undefined);
  if (missing.length > 0) {
    throw new Error(
      [
        `Integration suite cannot run. Missing: ${missing.join(", ")}.`,
        `Set them in ${join(repoRoot(), ".env")} (gitignored) or in the environment.`,
        "  SHEETS_TEST_ID          id of the disposable test spreadsheet",
        "  CALENDAR_TEST_ID        id of the throwaway test calendar",
        "  APPS_SCRIPT_EXEC_URL    /exec URL of the deployed Apps Script web app",
        "  APPS_SCRIPT_TEST_TOKEN  value of the script's TEST_TOKEN property",
        "These tests deliberately do NOT skip when the backend is absent.",
      ].join("\n"),
    );
  }
  return {
    sheetsTestId: envVar("SHEETS_TEST_ID")!,
    calendarTestId: envVar("CALENDAR_TEST_ID")!,
    execUrl: envVar("APPS_SCRIPT_EXEC_URL")!,
    testToken: envVar("APPS_SCRIPT_TEST_TOKEN")!,
  };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface RequestBody {
  token?: string;
  op?: string;
  payload?: unknown;
  mutationId?: string;
}

/**
 * How many times ONE request is sent before the suite gives up. Three, so there are two
 * retries, at roughly 1.5 s and 4 s.
 *
 * Apps Script does not publish a request limit for web apps, and it does not need to for
 * this to bite: a suite that fires several hundred requests at one deployment in twenty
 * minutes gets intermittently answered with Google's HTML "page not found" instead of the
 * script's output. That is throttling, not a bug in this server, and the run before this
 * one lost three tests to it — `test.write` and `test.read`, ops with no logic worth
 * failing on.
 */
const TRANSPORT_ATTEMPTS = 3;

/** Base backoff before attempt 2 and attempt 3. Jittered, so parallel calls disperse. */
const TRANSPORT_BACKOFF_MS = [1_500, 4_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ±30 %, so six concurrent requests do not all come back at the same instant. */
function jittered(ms: number): number {
  return Math.round(ms * (0.7 + Math.random() * 0.6));
}

/**
 * True for a body that IS one of this server's envelopes — a parsed object carrying a
 * boolean `ok`.
 *
 * This predicate is the whole safety argument for the retry. `Code.ts` answers every
 * request, success or failure, with HTTP 200 and exactly this shape; Google's throttling
 * and error pages answer with HTML and no shape at all. So "did an envelope come back?"
 * separates "the server replied" from "the request never got there", without the client
 * ever having to look at `ok`.
 */
function isEnvelope(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return typeof (value as { ok?: unknown }).ok === "boolean";
}

/**
 * One POST, with no deferred-clear flush. The bottom of the transport.
 *
 * Retries ONLY a transport failure: `fetch` itself throwing, or a response whose body is
 * not an envelope (Google's HTML 404/429/500/503 pages are all of this kind). Every
 * retry is logged, so a flaky run shows up in the output instead of being hidden by it.
 *
 * It does NOT retry — and never rewrites, unwraps or swallows — a well-formed envelope.
 * `{ok: false}` is the server having answered "no", which `auth.test.ts` asserts on
 * directly and which `concurrency.test.ts` requires to mean "nothing was written". A
 * retry there would turn a deliberate refusal into a duplicate write, and a real
 * regression into an intermittent pass. The envelope check happens before the status is
 * looked at at all, so nothing the server actually said can be discarded.
 *
 * The delivery guarantee this buys is AT LEAST ONCE, not exactly once. Nearly every
 * transport failure seen here is Google's front end answering with an HTML page before
 * the script runs at all, so the retry is the first execution — but a lost RESPONSE to a
 * request that did run would be re-executed. The ops the suite retries are safe under
 * that: `complete` carries the same `mutationId` on every attempt and dedupes on it,
 * `test.reset` wipes before it seeds so a second run lands the same rows, and `test.read`
 * and `test.calendar.list` write nothing. `test.write` is the one that would duplicate,
 * and `clearEverything_` in `TestSupport.ts` was made idempotent for exactly this reason.
 *
 * What this does NOT cover: a `{ok:false}` produced by the transport rather than by the
 * op. A POST whose redirect chain lands back on `/exec` is served by `doGet`, which
 * answers `{ok:false, error:"No token."}` — a well-formed envelope that is not an answer
 * to the request that was sent. It is left alone here, deliberately, because the rule
 * that an envelope is never second-guessed is worth more than catching it.
 */
async function send<T>(body: RequestBody): Promise<Envelope<T>> {
  const { execUrl } = requireIntegrationEnv();
  const op = body.op ?? "<none>";
  let problem = "no attempt was made";

  for (let attempt = 1; attempt <= TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(execUrl, {
        method: "POST",
        // text/plain keeps this a "simple" CORS request. Apps Script cannot answer a
        // preflight, so application/json would fail from the browser.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        redirect: "follow",
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      // The server answered. Hand it back exactly as it came, whatever it says.
      if (isEnvelope(parsed)) return parsed as Envelope<T>;
      problem =
        `HTTP ${response.status} with a body that is not an envelope. ` +
        `First 300 chars: ${text.slice(0, 300)}`;
    } catch (error) {
      problem = `fetch threw: ${error instanceof Error ? error.message : String(error)}`;
    }

    if (attempt === TRANSPORT_ATTEMPTS) break;
    const delay = jittered(TRANSPORT_BACKOFF_MS[attempt - 1] ?? 4_000);
    console.warn(
      `[testkit] transport failure on op "${op}" (attempt ${attempt}/${TRANSPORT_ATTEMPTS}), ` +
        `retrying in ${delay} ms — ${problem}`,
    );
    await sleep(delay);
  }

  throw new Error(
    `Apps Script did not return JSON for op "${op}" after ${TRANSPORT_ATTEMPTS} attempts. ` +
      `Last failure: ${problem}`,
  );
}

/**
 * POST an arbitrary envelope as `text/plain` JSON. Used directly by the auth
 * tests, which need to send a bad token and a body with no token at all.
 *
 * Flushes a deferred `clearAll()` first, so no request can ever reach the server ahead
 * of a wipe the caller has already asked for. See `clearAll`.
 */
export async function postEnvelope<T = unknown>(body: RequestBody): Promise<Envelope<T>> {
  await flushDeferredClear();
  return send<T>(body);
}

/** Convenience wrapper for a call that is expected to succeed. */
export async function call<T = unknown>(
  op: string,
  payload: unknown,
  opts: { token?: string; mutationId?: string } = {},
): Promise<Envelope<T>> {
  const { testToken } = requireIntegrationEnv();
  return postEnvelope<T>({
    token: opts.token ?? testToken,
    op,
    payload,
    mutationId: opts.mutationId ?? newId(),
  });
}

function unwrap<T>(envelope: Envelope<T>, what: string): T {
  if (!envelope.ok) throw new Error(`${what} failed: ${envelope.error ?? "no error message"}`);
  return envelope.data as T;
}

// ---------------------------------------------------------------------------
// Sheet and calendar access (test-support ops)
// ---------------------------------------------------------------------------

export async function readTab(tab: TabName): Promise<Row[]> {
  const data = unwrap(await call<{ rows: Row[] }>("test.read", { tab }), `test.read ${tab}`);
  return data.rows ?? [];
}

export async function writeRows(tab: TabName, rows: Row[]): Promise<void> {
  unwrap(await call("test.write", { tab, rows }), `test.write ${tab}`);
}

/**
 * Overwrites existing rows matched on `keyField`. Needed so a test can put the
 * sheet into a specific state (a cleared notification stamp, a live snooze)
 * without appending a duplicate row and without going through a production op.
 */
export async function updateRows(tab: TabName, keyField: string, rows: Row[]): Promise<void> {
  unwrap(await call("test.update", { tab, keyField, rows }), `test.update ${tab}`);
}

// ---------------------------------------------------------------------------
// clearAll / seedHousehold, and the one round trip they collapse into
// ---------------------------------------------------------------------------
// Every integration file opens with the same two lines:
//
//     await clearAll();
//     household = await seedHousehold();
//
// which used to be four requests — a wipe, then a People write, an Assets write and a
// Meta write — in the `beforeEach` of all thirty tests. A round trip to a deployed
// Apps Script web app costs about two and a half seconds before the op does any work:
// the POST to `/exec`, the 302, and the GET to googleusercontent.com that carries the
// body. That is a hundred and twenty requests and roughly five minutes of the run spent
// on transport, and it is also what pushes the deployment into Google's unpublished
// web-app throttling, which is where the HTML-404 failures come from.
//
// So `clearAll()` does not send anything. It RECORDS that a wipe is owed, and
// `seedHousehold()` — the call that always follows it — discharges that debt and the
// seed together in a single `test.reset`. Four requests become one.
//
// The deferral is safe because every other route to the server flushes it first:
// `postEnvelope` awaits `flushDeferredClear()` before it sends anything, and every
// helper in this file goes through `postEnvelope`. A test that clears and then reads
// still sees an empty sheet.
//
// The one visible consequence: a `clearAll()` with nothing after it — the `afterAll` in
// each file — never reaches the server, so the last file's fixtures are left sitting in
// the disposable sheet until the next run's first `beforeEach` wipes them. Nothing reads
// the sheet between those two moments, and every entry point clears before it asserts.

/** True when `clearAll()` has been called and no request has flushed it yet. */
let deferredClear = false;

/** The in-flight flush, so concurrent callers await one wipe rather than racing it. */
let pendingClear: Promise<void> | null = null;

/**
 * Sends the owed wipe, if there is one.
 *
 * Goes through `send` rather than `call`, deliberately: `call` routes through
 * `postEnvelope`, which flushes, which would call this again.
 */
async function flushDeferredClear(): Promise<void> {
  if (!deferredClear) {
    if (pendingClear !== null) await pendingClear;
    return;
  }
  deferredClear = false;
  const { testToken } = requireIntegrationEnv();
  pendingClear = send({ token: testToken, op: "test.clear", payload: {}, mutationId: newId() })
    .then((envelope) => {
      unwrap(envelope, "test.clear");
    })
    .finally(() => {
      pendingClear = null;
    });
  await pendingClear;
}

/**
 * Wipes every data tab and deletes every event on the test calendar.
 *
 * DEFERRED — see the block comment above. The wipe is sent by whichever request comes
 * next, or folded into `test.reset` when the next thing is `seedHousehold()`.
 */
export function clearAll(): Promise<void> {
  deferredClear = true;
  return Promise.resolve();
}

export async function listCalendar(timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  const data = unwrap(
    await call<{ events: CalendarEvent[] }>("test.calendar.list", { timeMin, timeMax }),
    "test.calendar.list",
  );
  return data.events ?? [];
}

/** Creates a tagged event directly, with no matching instance. Orphan setup. */
export async function createTaggedEvent(input: {
  instanceId: string;
  title: string;
  startAt: string;
}): Promise<string> {
  const data = unwrap(
    await call<{ eventId: string }>("test.calendar.create", input),
    "test.calendar.create",
  );
  return data.eventId;
}

/** Wide window around "now", so a listing never misses a test's own event. */
export function calendarWindow(): { timeMin: string; timeMax: string } {
  const now = Date.now();
  return {
    timeMin: new Date(now - 365 * DAY).toISOString(),
    timeMax: new Date(now + 365 * DAY).toISOString(),
  };
}

export async function listAllCalendar(): Promise<CalendarEvent[]> {
  const { timeMin, timeMax } = calendarWindow();
  return listCalendar(timeMin, timeMax);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const DAY = 86_400_000;
export const TIME_ZONE = "Pacific/Auckland";

export function newId(): string {
  return randomUUID();
}

export function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

export interface Household {
  personA: { id: string; displayName: string; token: string };
  personB: { id: string; displayName: string; token: string };
  houseAssetId: string;
}

/**
 * Seeds People, Assets and Meta by raw row write, not through production ops, so
 * a broken `chore.create` cannot make an unrelated test fail for the wrong reason.
 *
 * The ids are minted HERE, on the client, and sent to the server — never invented by
 * the server and read back. The tests hold `household.personA.token` and send production
 * ops with it, so the caller has to be the one who knows it.
 *
 * When a `clearAll()` is outstanding this is one `test.reset` instead of a wipe plus
 * three writes. When it is not — a test seeding a second household mid-run — it is the
 * three writes it always was.
 */
export async function seedHousehold(): Promise<Household> {
  const personA = { id: newId(), displayName: "Apoorva", token: newId() };
  const personB = { id: newId(), displayName: "Flatmate", token: newId() };
  const houseAssetId = newId();
  const people: Row[] = [
    { id: personA.id, displayName: personA.displayName, token: personA.token },
    { id: personB.id, displayName: personB.displayName, token: personB.token },
  ];
  const assets: Row[] = [
    { id: houseAssetId, kind: "house", budget: 60 },
    { id: newId(), kind: "garden", budget: 25 },
    { id: newId(), kind: "car", budget: 30 },
  ];
  const meta: Row[] = [{ key: "timeZone", value: TIME_ZONE }];

  if (deferredClear) {
    // Consumed, not flushed: `test.reset` performs the wipe itself, in the same lock.
    deferredClear = false;
    unwrap(
      await call("test.reset", { tabs: { People: people, Assets: assets, Meta: meta } }),
      "test.reset",
    );
    return { personA, personB, houseAssetId };
  }

  await writeRows("People", people);
  await writeRows("Assets", assets);
  await writeRows("Meta", meta);
  return { personA, personB, houseAssetId };
}

export interface SeededChore {
  id: string;
  title: string;
  assetId: string;
  /** clamp(round(2*time + 2*effort + 3*priority), 5, 35) — the server must agree. */
  expectedPoints: number;
}

/**
 * Seeds one Chore row directly. Weights default to all-1, whose server-computed
 * points are 2*1 + 2*1 + 3*1 = 7.
 */
export async function seedChore(
  assetId: string,
  overrides: Partial<Row> & { weightTime?: number; weightEffort?: number; weightPriority?: number } = {},
): Promise<SeededChore> {
  const id = newId();
  const title = (overrides.title as string) ?? `Chore ${id.slice(0, 8)}`;
  const time = overrides.weightTime ?? 1;
  const effort = overrides.weightEffort ?? 1;
  const priority = overrides.weightPriority ?? 1;
  const row: Row = {
    id,
    title,
    assetId,
    weightTime: time,
    weightEffort: effort,
    weightPriority: priority,
    recurrenceUnit: "month",
    recurrenceN: 1,
    nextDueAt: iso(-2 * DAY),
    deadlineDate: "",
    leadTimeDays: "",
    deletedAt: "",
    ...overrides,
  };
  await writeRows("Chores", [row]);
  return {
    id,
    title,
    assetId,
    expectedPoints: Math.min(35, Math.max(5, Math.round(2 * time + 2 * effort + 3 * priority))),
  };
}

/** Seeds one Instances row directly, bypassing DueSweep. */
export async function seedInstance(
  choreId: string,
  overrides: Partial<Row> = {},
): Promise<string> {
  const instanceId = (overrides.instanceId as string) ?? newId();
  await writeRows("Instances", [
    {
      instanceId,
      choreId,
      dueAt: iso(-2 * DAY),
      calendarEventId: "",
      lastNotifiedAt: "",
      snoozedUntil: "",
      ...overrides,
    },
  ]);
  return instanceId;
}

// ---------------------------------------------------------------------------
// Production op shorthands
// ---------------------------------------------------------------------------

export interface CompletionData {
  completion?: Row;
  alreadyCompletedBy?: string;
}

export function complete(input: {
  instanceId: string;
  choreId: string;
  personId: string;
  token: string;
  mutationId?: string;
  pointsAwarded?: number;
}): Promise<Envelope<CompletionData>> {
  const { instanceId, choreId, personId, token, mutationId, pointsAwarded } = input;
  return postEnvelope<CompletionData>({
    token,
    op: "complete",
    mutationId: mutationId ?? newId(),
    payload: {
      instanceId,
      choreId,
      personId,
      completedAt: new Date().toISOString(),
      ...(pointsAwarded === undefined ? {} : { pointsAwarded }),
    },
  });
}

export interface SweepData {
  created?: string[];
  notified?: string[];
}

export function runSweep(nowIso: string): Promise<Envelope<SweepData>> {
  return call<SweepData>("sweep.run", { now: nowIso });
}

export function reconcileCalendar(nowIso: string): Promise<Envelope<{ removed?: string[] }>> {
  return call<{ removed?: string[] }>("calendar.reconcile", { now: nowIso });
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

export function rowsWhere(rows: Row[], field: string, value: string): Row[] {
  return rows.filter((row) => String(row[field] ?? "") === value);
}

export async function completionsFor(instanceId: string): Promise<Row[]> {
  return rowsWhere(await readTab("Completions"), "instanceId", instanceId);
}

export async function instancesFor(choreId: string): Promise<Row[]> {
  return rowsWhere(await readTab("Instances"), "choreId", choreId);
}

export function eventsFor(events: CalendarEvent[], instanceId: string): CalendarEvent[] {
  return events.filter((event) => event.instanceId === instanceId);
}

/**
 * The per-test and per-hook budget. Three minutes.
 *
 * It was 60_000, and two `beforeEach` hooks timed out on the last full run. The number
 * has to cover the WORST healthy call, not the average one, and three things stack:
 *
 *   - one request is about 2.5 s of transport before any work happens, and a `sweep.run`
 *     or a `test.reset` against a real spreadsheet and calendar is several seconds more;
 *   - a test body makes ten or so of those in sequence;
 *   - `send` now retries a throttled request twice, at ~1.5 s and ~4 s of backoff, so a
 *     single unlucky call can cost three round trips plus 5.5 s of waiting.
 *
 * 180_000 leaves a healthy-but-slow test room to finish instead of being reported red
 * for a reason that has nothing to do with what it asserts.
 *
 * ---------------------------------------------------------------------------
 * Its relationship with `lockTimeoutMs_` in `Store.ts`
 * ---------------------------------------------------------------------------
 * That number — 25_000 — is pinned by THIS one, and the rule is unchanged in shape:
 * a request that queues for the script lock for the full wait, and then loses it, must
 * still be able to return its `ok:false` inside the test budget, because
 * `concurrency.test.ts` asserts on that refusal and a timeout instead would report a
 * green implementation red.
 *
 * The margin used to be 25 s inside 60 s. It is now 25 s inside 180 s, with the retry
 * budget (three attempts plus ~5.5 s of backoff) sitting between them: worst case a
 * contended call costs 3 × (25 s lock wait + transport) + 5.5 s, comfortably under three
 * minutes. Raising the lock wait would eat that margin, so it stays at 25_000 — the
 * headroom here is spent on slow requests and retries, not on longer queuing.
 */
export const TEST_TIMEOUT_MS = 180_000;
