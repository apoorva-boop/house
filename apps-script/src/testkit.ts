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
 * POST an arbitrary envelope as `text/plain` JSON. Used directly by the auth
 * tests, which need to send a bad token and a body with no token at all.
 */
export async function postEnvelope<T = unknown>(body: RequestBody): Promise<Envelope<T>> {
  const { execUrl } = requireIntegrationEnv();
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
    throw new Error(
      `Apps Script did not return JSON (HTTP ${response.status}) for op "${body.op ?? "<none>"}". ` +
        `First 300 chars: ${text.slice(0, 300)}`,
    );
  }
  return parsed as Envelope<T>;
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

/** Wipes every data tab and deletes every event on the test calendar. */
export async function clearAll(): Promise<void> {
  unwrap(await call("test.clear", {}), "test.clear");
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
 */
export async function seedHousehold(): Promise<Household> {
  const personA = { id: newId(), displayName: "Apoorva", token: newId() };
  const personB = { id: newId(), displayName: "Flatmate", token: newId() };
  const houseAssetId = newId();
  await writeRows("People", [
    { id: personA.id, displayName: personA.displayName, token: personA.token },
    { id: personB.id, displayName: personB.displayName, token: personB.token },
  ]);
  await writeRows("Assets", [
    { id: houseAssetId, kind: "house", budget: 60 },
    { id: newId(), kind: "garden", budget: 25 },
    { id: newId(), kind: "car", budget: 30 },
  ]);
  await writeRows("Meta", [{ key: "timeZone", value: TIME_ZONE }]);
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

/** Every test file uses the same setup/teardown, so state never leaks between runs. */
export const TEST_TIMEOUT_MS = 60_000;
