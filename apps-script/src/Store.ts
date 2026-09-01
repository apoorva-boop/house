// Row access for the spreadsheet that backs the server. A SCRIPT, not a module.
//
// ---------------------------------------------------------------------------
// Everything is text
// ---------------------------------------------------------------------------
// Every cell this server writes is written into a range whose number format has first
// been set to "@" (plain text), and every cell it reads comes back through
// `getDisplayValues()`, which returns strings.
//
// That is not fussiness. The schema is ISO-8601-with-offset TIMESTAMPS in text columns.
// Left to itself, Sheets parses a string that looks like a date into a date CELL, and a
// date cell is rendered back in the spreadsheet's own time zone with the offset thrown
// away. A completion written at 09:00+13:00 would read back as a different instant, and
// the `dedupe` test — which asserts that a replayed mutation returns the SAME
// `completedAt` the first call stored — would fail for a reason that looks like a
// concurrency bug and is actually a locale bug.
//
// Numbers survive this fine: `pointsAwarded` stored as "7" reads back as "7", and every
// caller that wants arithmetic goes through `Number(...)`.

/** One data row, plus the sheet row number so a caller can write back to it. */
interface SheetRow {
  readonly rowNumber: number;
  readonly values: Record<string, string>;
}

/**
 * The tab, created with its header row if it is missing.
 *
 * The header row is rewritten whenever it does not match the schema. A tab whose columns
 * have drifted is worse than a tab that does not exist: reads silently return the wrong
 * field.
 */
function sheetFor_(tab: string): GoogleAppsScript.Spreadsheet.Sheet {
  const headers = headersFor_(tab);
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(tab);
  if (sheet === null) sheet = ss.insertSheet(tab);

  ensureCapacity_(sheet, 1, headers.length);
  const existing = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0] ?? [];
  let matches = true;
  for (let i = 0; i < headers.length; i += 1) {
    if (asText_(existing[i]) !== asText_(headers[i])) matches = false;
  }
  if (!matches) {
    const range = sheet.getRange(1, 1, 1, headers.length);
    range.setNumberFormat("@");
    range.setValues([headers.slice()]);
  }
  return sheet;
}

/** Grows the grid so `getRange` cannot throw for a row or column past the edge. */
function ensureCapacity_(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  rows: number,
  columns: number,
): void {
  const maxRows = sheet.getMaxRows();
  if (rows > maxRows) sheet.insertRowsAfter(maxRows, rows - maxRows);
  const maxColumns = sheet.getMaxColumns();
  if (columns > maxColumns) sheet.insertColumnsAfter(maxColumns, columns - maxColumns);
}

/** Every data row of a tab, keyed by header name. Blank cells read as "". */
function readRows_(tab: string): SheetRow[] {
  const headers = headersFor_(tab);
  const sheet = sheetFor_(tab);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const grid = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
  const rows: SheetRow[] = [];
  for (let r = 0; r < grid.length; r += 1) {
    const line = grid[r] ?? [];
    const values: Record<string, string> = {};
    let blank = true;
    for (let c = 0; c < headers.length; c += 1) {
      const header = headers[c];
      if (header === undefined) continue;
      const cell = asText_(line[c]);
      values[header] = cell;
      if (cell !== "") blank = false;
    }
    // A wholly blank line is grid padding left behind by a delete, not a record.
    if (!blank) rows.push({ rowNumber: r + 2, values });
  }
  return rows;
}

function toMatrix_(headers: string[], rows: Record<string, unknown>[]): string[][] {
  return rows.map((row) => headers.map((header) => asText_(row[header])));
}

/** Appends rows to the bottom of a tab. */
function appendRows_(tab: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  const headers = headersFor_(tab);
  const sheet = sheetFor_(tab);
  const start = Math.max(sheet.getLastRow() + 1, 2);
  ensureCapacity_(sheet, start + rows.length - 1, headers.length);

  const range = sheet.getRange(start, 1, rows.length, headers.length);
  range.setNumberFormat("@");
  range.setValues(toMatrix_(headers, rows));
}

/** Overwrites one existing row wholesale. `rowNumber` comes from `readRows_`. */
function writeRow_(tab: string, rowNumber: number, values: Record<string, unknown>): void {
  const headers = headersFor_(tab);
  const sheet = sheetFor_(tab);
  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  range.setNumberFormat("@");
  range.setValues(toMatrix_(headers, [values]));
}

/** Overwrites only the named fields of an existing row, leaving the rest alone. */
function patchRow_(tab: string, row: SheetRow, patch: Record<string, unknown>): void {
  const merged: Record<string, unknown> = {};
  for (const header of headersFor_(tab)) merged[header] = row.values[header] ?? "";
  for (const key of Object.keys(patch)) merged[key] = patch[key];
  writeRow_(tab, row.rowNumber, merged);
}

/**
 * Deletes rows by sheet row number. Highest first, so deleting one row cannot shift the
 * number of another row still to be deleted.
 */
function deleteRows_(tab: string, rowNumbers: number[]): void {
  if (rowNumbers.length === 0) return;
  const sheet = sheetFor_(tab);
  const ordered = rowNumbers.slice().sort((a, b) => b - a);
  for (const rowNumber of ordered) sheet.deleteRow(rowNumber);
}

/** Removes every data row of a tab, keeping the header. */
function clearTab_(tab: string): void {
  const sheet = sheetFor_(tab);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) sheet.deleteRows(2, lastRow - 1);
}

function findRow_(rows: SheetRow[], field: string, value: string): SheetRow | null {
  for (const row of rows) {
    if (row.values[field] === value) return row;
  }
  return null;
}

function filterRows_(rows: SheetRow[], field: string, value: string): SheetRow[] {
  return rows.filter((row) => row.values[field] === value);
}

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

/**
 * Runs `body` under the SCRIPT lock.
 *
 * `getScriptLock()`, never `getUserLock()`. This web app is deployed
 * `executeAs: USER_DEPLOYING`, so every request — from every phone, from every person —
 * runs as the same Google account. A user lock is therefore held by that one account and
 * never contends with itself. It would look correct in every manual test and protect
 * nothing on the day two people tick the same chore.
 *
 * A caller that cannot get the lock gets an error, not a silent success. `ok: true` has
 * to mean the write landed.
 */
function withScriptLock_<T>(body: () => T): T {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(lockTimeoutMs_());
  } catch {
    throw new Error(
      `Busy: could not acquire the script lock within ${String(lockTimeoutMs_())}ms. ` +
        "Nothing was written. Retry the same mutationId.",
    );
  }
  try {
    return body();
  } finally {
    lock.releaseLock();
  }
}

/**
 * 25 s. Do NOT raise this back to 120 s.
 *
 * The number is pinned by the test budget, not by the execution limit. `testkit.ts` sets
 * `TEST_TIMEOUT_MS = 60_000`, and the six-way contention test asserts a clean
 * `ok:false` when a request cannot get the lock. At 120_000 a genuinely queued sixth
 * request would sit for 120 s — past vitest's 60 s budget — so the test would fail as a
 * TEST TIMEOUT instead of the refusal it was written to assert: a green implementation
 * reported red for the wrong reason.
 *
 * 25_000 is comfortably inside the 60 s budget while still being far longer than any
 * real contention between two people tapping "done" at once, and still well inside the
 * six-minute execution limit, so a request fails with a message rather than being killed.
 *
 * Raising this means raising TEST_TIMEOUT_MS first. Both numbers move together.
 */
function lockTimeoutMs_(): number {
  return 25_000;
}

// ---------------------------------------------------------------------------
// Version counter
// ---------------------------------------------------------------------------

/**
 * A monotonic counter the client uses to tell whether its snapshot is stale. Bumped once
 * per mutation, inside the lock, so it cannot skip or repeat.
 */
function bumpVersion_(): number {
  const properties = PropertiesService.getScriptProperties();
  const next = asNumber_(properties.getProperty("VERSION"), 0) + 1;
  properties.setProperty("VERSION", String(next));
  return next;
}

function currentVersion_(): number {
  return asNumber_(scriptProperty_("VERSION"), 0);
}
