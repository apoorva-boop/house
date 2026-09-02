// Shared configuration for the Apps Script server.
//
// This file is a SCRIPT, not a module: no `import`, no `export`. Apps Script has no
// module system, and `scripts/build-appsscript.mjs` transpiles each file with esbuild's
// `transform` rather than bundling it, so every top-level declaration below is a global
// the other `.gs` files see directly.
//
// Nothing here runs at load time. Every constant is returned from a function instead of
// bound to a top-level `const`, so no file can read another file's value before that
// file has been evaluated. Apps Script does not promise a load order, and a temporal
// dead zone error at load would take the whole web app down rather than one request.

// ---------------------------------------------------------------------------
// The bundled domain rules
// ---------------------------------------------------------------------------
// `apps-script/build/domain.js` (built by `pnpm build:domain`) assigns one global,
// `Domain`. This is an ambient declaration: it emits nothing, and it is the ONLY
// description of the domain surface this server uses. The rules themselves live in
// `packages/domain` and are never reimplemented here — a second copy of `weight` or
// `nextDueFrom` would drift from the one the client scores against.

/** A chore as the domain models it, as opposed to as the spreadsheet stores it. */
interface DomainChore {
  readonly id: string;
  readonly title: string;
  readonly assetId: string;
  readonly weight: { readonly time: number; readonly effort: number; readonly priority: number };
  readonly recurrence:
    | { readonly kind: "interval"; readonly unit: string; readonly n: number }
    | { readonly kind: "timesPerYear"; readonly timesPerYear: number }
    | null;
  readonly deadlineDate: string | null;
  readonly leadTimeDays: number | null;
  readonly urgencyCurve: "linear" | "steep" | null;
}

/** A materialised occurrence as the domain models it. Timestamps are epoch millis. */
interface DomainInstance {
  readonly instanceId: string;
  readonly choreId: string;
  readonly dueAt: number;
  readonly overdueDays: number;
  readonly calendarEventId: string | null;
  readonly lastNotifiedAt: number | null;
  readonly snoozedUntil: number | null;
}

interface DomainCtx {
  readonly now: number;
  readonly timeZone: string;
}

// `Domain` is provided at runtime by a different file in the same global scope
// (apps-script/build/domain.js). A per-file linter cannot see that assignment, and an
// ambient declaration emits nothing, so there is nothing here for it to bind to.
declare const Domain: {
  weight(w: { time: number; effort: number; priority: number }): number;
  nextDueFrom(ctx: DomainCtx, lastDone: number, chore: DomainChore): number;
  eligible(
    ctx: DomainCtx,
    instance: DomainInstance,
    policy: { repeatEveryHours: number | null },
  ): boolean;
  /**
   * The starting chore list, from `packages/domain/src/seed/defaultChores.ts`.
   *
   * The LIST is the domain's and is never restated on this side. The DATES on it are
   * not: every `deadlineDate` in there is a hardcoded placeholder, and `Seed.ts`
   * replaces each one with a date measured from this server's clock. See the header of
   * `Seed.ts` for why the domain cannot compute them itself.
   */
  defaultChores(): DomainChore[];
  /** Points per week each asset is worth, keyed by asset kind. */
  readonly DEFAULT_BUDGETS: Record<string, number>;
  /**
   * SHA-256 of the `packages/domain` sources this bundle was built from, appended by
   * `scripts/build-domain.mjs`. Read only by `assertDomainBundleFresh_` below.
   */
  readonly SOURCE_HASH: string;
};

// ---------------------------------------------------------------------------
// Is the deployed bundle the one this server was built against?
// ---------------------------------------------------------------------------
// The ambient declaration above emits nothing. `tsc` therefore type-checks this server
// against a signature the deployed `domain.js` may not actually have, and it will not
// notice if it does not — which is not a hypothetical. `weight` was implemented in
// `packages/domain`, `apps-script/build/domain.js` still held the stub, the push went
// out, and every chore scored the clamp floor. Four failing tests were the only signal.
//
// `pnpm build` stamps the same domain-source fingerprint into two files:
//
//   build/domain.js        as `Domain.SOURCE_HASH`
//   build/BundleStamp.js   as `expectedDomainHash_()`
//
// They agree only when both halves were built from the same tree. A half-rebuilt
// `apps-script/build/` — which is exactly what a hand-run `npx clasp push` uploads,
// since it never builds anything — makes them disagree, and this turns that into an
// `{ok:false}` on the very first request instead of a wrong number nobody queries.
//
// The wholly-stale case (nothing rebuilt, both halves old but consistent) cannot be
// seen from here: a deployed script has no access to the source files. That one is
// `pnpm check:bundle`, which reads the working tree. This is the half that survives
// somebody skipping the build entirely.
//
// `expectedDomainHash_` is a top-level function declaration in a generated file, so it
// is hoisted and load order does not matter. It has no `.ts` source, hence the ambient
// declaration.
declare function expectedDomainHash_(): string;

/**
 * Throws unless `domain.js` and `BundleStamp.js` came from the same build.
 *
 * Called from `handleRequest_` before authentication, so nothing runs against a bundle
 * whose behaviour the rest of this server has not been type-checked against. `doPost`
 * and `doGet` both catch, so this surfaces as a normal error envelope, not as Google's
 * HTML error page.
 */
function assertDomainBundleFresh_(): void {
  if (typeof Domain === "undefined" || typeof Domain.SOURCE_HASH !== "string") {
    throw new Error(
      "domain.js is missing or predates the freshness stamp. The deployment is " +
        "incomplete: run `pnpm clasp:push`.",
    );
  }
  if (typeof expectedDomainHash_ !== "function") {
    throw new Error(
      "BundleStamp.js was not deployed. The deployment is incomplete: run `pnpm clasp:push`.",
    );
  }
  const expected = expectedDomainHash_();
  if (Domain.SOURCE_HASH !== expected) {
    throw new Error(
      "Stale deployment. The server files were built from domain sources " +
        `${expected.slice(0, 12)}, but domain.js holds ${Domain.SOURCE_HASH.slice(0, 12)}. ` +
        "Something pushed a half-built apps-script/build/. Run `pnpm clasp:push`.",
    );
  }
}

// ---------------------------------------------------------------------------
// Sheet schema
// ---------------------------------------------------------------------------

/**
 * Column headers per tab, in order. THIS is the schema: `sheetFor_` writes this header
 * row, so a tab has these columns and no others.
 *
 * `SCHEMA` in `apps-script/src/testkit.ts` is a SUBSET of it, not a copy, and the two
 * are already different on purpose:
 *
 *   - `Instances` here ends with `scheduleState`; testkit's does not. The integration
 *     suite reads and writes rows by header NAME, so a column it never names costs it
 *     nothing.
 *   - `Subscriptions` and `ResetProposals` are listed here and absent there. They exist
 *     so the tabs are created on the first run and so `test.clear` knows to wipe them.
 *     Nothing in this pull request writes to either.
 *
 * The direction that matters is one-way: every column testkit names must appear here,
 * because the server is what creates the tab. Columns here that testkit does not name
 * are fine. Nothing enforces even that — testkit is frozen, and a check that fails on
 * the differences listed above would fail from the moment it was written, so the honest
 * statement is this comment rather than a red build. If you REMOVE or RENAME a column
 * below, grep `SCHEMA` in testkit.ts before you do.
 */
function sheetSchema_(): Record<string, string[]> {
  return {
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
    // `scheduleState` is appended, never inserted: the header row is rewritten in place
    // by `sheetFor_`, so a new column at the END leaves every existing cell where it is.
    Instances: [
      "instanceId",
      "choreId",
      "dueAt",
      "calendarEventId",
      "lastNotifiedAt",
      "snoozedUntil",
      "scheduleState",
    ],
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
    Subscriptions: ["subscriptionId", "personId", "endpoint", "keys", "state", "lastSeenAt"],
    ResetProposals: ["id", "proposedBy", "proposedAt", "state"],
    Meta: ["key", "value"],
  };
}

function tabNames_(): string[] {
  return Object.keys(sheetSchema_());
}

function headersFor_(tab: string): string[] {
  const headers = sheetSchema_()[tab];
  if (headers === undefined) throw new Error(`Unknown tab "${tab}".`);
  return headers;
}

// ---------------------------------------------------------------------------
// Script properties
// ---------------------------------------------------------------------------
// Exactly two properties configure a deployment, because a script property can only be
// set by a human in the Apps Script editor — neither clasp nor the Apps Script API can
// write one. Everything else that varies between deployments lives in the `Meta` tab,
// which the API can reach. None of this is committed; the repo is public.
//
//   TEST_TOKEN    authorises the `test.*` namespace, and nothing else
//   TEST_MODE     must be exactly "true" before any `test.*` op will run at all
//
// TEST_MODE is the important one. `test.clear` wipes every data tab and deletes every
// event this server put on the calendar. Shipping that op behind a token alone would leave a data-wiping
// endpoint live on a public URL forever. The ops are compiled into every deployment, but
// they are inert unless the deployment's owner has deliberately set TEST_MODE. The test
// project sets it; the production project never will.

function scriptProperty_(name: string): string {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  return value === null ? "" : value;
}

/** True only for the exact string "true". Any other value, and absence, mean off. */
function testModeEnabled_(): boolean {
  return scriptProperty_("TEST_MODE") === "true";
}

function testToken_(): string {
  return scriptProperty_("TEST_TOKEN");
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

/**
 * The bound spreadsheet. The manifest asks for `spreadsheets.currentonly`, which reaches
 * the script's OWN container and nothing else in Drive — so this is the only way in, and
 * a standalone copy of this script would fail loudly here rather than quietly touching
 * the wrong file.
 */
function spreadsheet_(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss === null) {
    throw new Error(
      "No bound spreadsheet. This script must stay container-bound: the manifest asks " +
        "for spreadsheets.currentonly, which cannot open a file by id.",
    );
  }
  return ss;
}

/** Reads one `Meta` row by key. `Meta` is the deployment's configuration tab. */
function metaValue_(key: string): string {
  for (const row of readRows_("Meta")) {
    if (row.values["key"] === key) {
      const value = row.values["value"];
      if (value !== undefined && value !== "") return value;
    }
  }
  return "";
}

/** The household time zone, from `Meta`. The domain rules do date arithmetic in it. */
function householdTimeZone_(): string {
  const configured = metaValue_("timeZone");
  return configured === "" ? Session.getScriptTimeZone() : configured;
}

/**
 * The id of the calendar this deployment notifies through, from two places in order.
 *
 * 1. The `Meta` row `calendarId`. First because the API can write it, which means the
 *    test suite can control it and a fresh spreadsheet can be configured without a human
 *    in the Apps Script editor.
 * 2. The `CALENDAR_ID` script property. The durable floor: it belongs to the deployment
 *    rather than to the spreadsheet, so a clean checkout that has not seeded `Meta` yet
 *    still works, and the test project and the production project can legitimately point
 *    at different calendars.
 *
 * There is deliberately no third option. Falling back to the account's default calendar
 * would write chore reminders into somebody's real diary — the worst failure this code
 * has — and it would do it silently, which is how it would survive review.
 */
function calendarId_(): string {
  const fromMeta = metaValue_("calendarId");
  if (fromMeta !== "") return fromMeta;
  return scriptProperty_("CALENDAR_ID");
}

function calendar_(): GoogleAppsScript.Calendar.Calendar {
  const id = calendarId_();
  if (id === "") {
    throw new Error(
      "No calendar configured, and this server will not guess one. Set it in either " +
        'place: a Meta row {key: "calendarId", value: "<calendar id>"} in the bound ' +
        "spreadsheet, or a CALENDAR_ID script property. The value is the calendar's id, " +
        "which looks like an email address and is on the calendar's settings page.",
    );
  }
  const calendar = CalendarApp.getCalendarById(id);
  if (calendar === null) throw new Error(`No calendar with id "${id}" is visible to this account.`);
  return calendar;
}

// ---------------------------------------------------------------------------
// Small value helpers
// ---------------------------------------------------------------------------

/** Every cell is read and written as text, so every conversion goes through here. */
function asText_(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function asNumber_(value: unknown, fallback: number): number {
  const parsed = Number(asText_(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Epoch millis for an ISO-8601 text column, or `null` when the cell is blank or junk. */
function parseIso_(value: unknown): number | null {
  const text = asText_(value);
  if (text === "") return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso_(ms: number): string {
  return new Date(ms).toISOString();
}

function newId_(): string {
  return Utilities.getUuid();
}
