// The `test.*` namespace. A SCRIPT, not a module.
//
// ---------------------------------------------------------------------------
// Why these ops exist, and why they are inert by default
// ---------------------------------------------------------------------------
// The integration suite has to put the sheet into a specific state — a cleared
// notification stamp, a live snooze, a tagged event with no matching row — without going
// through a production op, because a broken production op must not be able to make an
// unrelated test fail for the wrong reason. That means raw row access, which means a
// backdoor.
//
// So the backdoor is built to be switched off, and it is off unless somebody has
// deliberately switched it on. `authenticate_` refuses this whole namespace unless the
// TEST_MODE script property is exactly "true", BEFORE it looks at any token. The ops are
// compiled into every deployment and are dead code in all but the test project.
//
// That gate is not belt-and-braces. `test.clear` and `test.reset` wipe every data tab and delete every
// event this server put on the calendar. Guarding it with a token alone would leave a data-wiping
// endpoint live on a public URL for as long as the deployment exists, one leaked string
// away from erasing a household's history. A property only a human can set, in a project
// only Apoorva owns, is the difference between "hard to reach" and "not present".

/** `Meta` keys that are configuration, not test data. Survive `test.clear`. */
function metaConfigKeys_(): string[] {
  return ["calendarId"];
}

/**
 * How far either side of "now" a test wipe looks for events to delete. 120 days.
 *
 * NOT the sweep's window. `calendarWindow_` spans 400 days each way because a reminder
 * this server writes can legitimately sit anywhere in that span, and a sweep that missed
 * one would leave an orphan behind forever. A test wipe has a much smaller job: it only
 * has to catch what the suite itself put there since the last wipe.
 *
 * The furthest-out event any fixture can produce is the seeded warrant of fitness —
 * `seedDeadlineMs_` puts it at `leadTimeDays + 14` days, and the largest lead time in
 * `defaultChores()` is 30, so 44 days. The furthest back is a fixture instance seeded at
 * -14 days. 120 days each way is therefore between two and eight times the widest thing
 * the suite can create, which is margin enough that a new fixture would have to be
 * wildly out of character to escape it.
 *
 * If you add a fixture that schedules further out than this, widen this number — an
 * event outside the wipe window survives into the next test and will be counted by
 * `listAllCalendar()`, which still looks 365 days each way.
 */
function testClearCalendarWindowMs_(): number {
  return 120 * 24 * 60 * 60 * 1000;
}

/**
 * Wipes every data tab, and every event on the calendar THIS SERVER CREATED.
 *
 * `calendarId` is never removed. It is the deployment's configuration, not a fixture: the
 * suite never writes it, so clearing it would leave the server unable to find the
 * calendar for the rest of the run — and "find the calendar" is not a thing to get wrong
 * by default, because the wrong answer is somebody's real calendar. Nothing in the suite
 * reads `Meta`, so the surviving row is invisible to it.
 *
 * No lock and no version bump here, so `test.clear` and `test.reset` can run exactly
 * these steps inside ONE lock rather than each keeping its own copy of them.
 */
function clearEverything_(): { clearedTabs: string[]; deletedEvents: number } {
  const config = metaConfigKeys_();

  for (const tab of tabNames_()) {
    // `Meta` is the one tab that is not wiped and rebuilt. It used to be: the config rows
    // were read out, every tab was cleared, and the config rows were appended back. That
    // leaves a window in which `calendarId` is not on the sheet at all, and the window is
    // reachable — `testkit.ts` now RETRIES a request whose response was lost, so a run
    // that died between the clear and the re-append would be followed by a second run
    // that read an already-empty `Meta`, found no config to preserve, and destroyed the
    // calendar id for good. Every later op then failed with "No calendar configured".
    //
    // Deleting only the rows that are NOT configuration has no such window, and is
    // idempotent however many times it runs.
    if (tab === "Meta") continue;
    clearTab_(tab);
  }

  const doomed: number[] = [];
  for (const row of readRows_("Meta")) {
    if (config.indexOf(asText_(row.values["key"])) === -1) doomed.push(row.rowNumber);
  }
  deleteRows_("Meta", doomed);

  let deletedEvents = 0;
  if (calendarId_() !== "") {
    // Only events this server created, found by the same tag `reconcileCalendar_` keys
    // on. The unfiltered listing this replaced deleted everything in the window,
    // including events a person had put there by hand — so a `CALENDAR_ID` pointed one
    // character wrong, at somebody's real diary, would have emptied thirteen months of
    // it on the next `clearAll()`. An untagged event is not ours to delete, ever.
    // `taggedEventsBetween_` carries that filter; only the WIDTH is narrowed here.
    const now = Date.now();
    const span = testClearCalendarWindowMs_();
    for (const event of taggedEventsBetween_(new Date(now - span), new Date(now + span))) {
      event.deleteEvent();
      deletedEvents += 1;
    }
  }

  return { clearedTabs: tabNames_(), deletedEvents };
}

function opTestClear_(): unknown {
  return withScriptLock_(() => {
    const result = clearEverything_();
    bumpVersion_();
    return result;
  });
}

/**
 * Wipe, then seed, in ONE request.
 *
 * Every integration file's `beforeEach` clears the sheet and then writes the same three
 * fixture tabs — People, Assets and Meta. Done from the client that is four round trips,
 * and a round trip to a deployed Apps Script web app costs about two and a half seconds
 * before the op does any work at all: the POST to `/exec`, the 302, and the GET to
 * `googleusercontent.com` that actually carries the body. Four calls per test across
 * thirty tests is three hundred requests of pure transport, and undocumented web-app
 * throttling makes the tail of that far worse than its average.
 *
 * The rows arrive from the client rather than being invented here on purpose: the tests
 * hold the person tokens they mint and assert against them, so the ids must be the
 * caller's. This op contributes the ordering and the single lock, not the data.
 *
 * One `bumpVersion_` for the whole thing, because it is one state change.
 */
function opTestReset_(payload: Record<string, unknown>): unknown {
  const tabs = payload["tabs"];
  if (tabs === null || typeof tabs !== "object" || Array.isArray(tabs)) {
    throw new Error("test.reset requires a `tabs` object keyed by tab name.");
  }
  const byTab = tabs as Record<string, unknown>;
  // Validated BEFORE the lock is taken and before anything is wiped, so a typo in a tab
  // name refuses the request outright rather than leaving the sheet cleared and unseeded.
  const names = Object.keys(byTab);
  const seedRows: Record<string, Record<string, unknown>[]> = {};
  for (const tab of names) {
    headersFor_(tab); // throws on an unknown tab
    seedRows[tab] = asRowArray_(byTab[tab]);
  }

  return withScriptLock_(() => {
    const cleared = clearEverything_();
    let seeded = 0;
    for (const tab of names) {
      const rows = seedRows[tab] ?? [];
      appendRows_(tab, rows);
      seeded += rows.length;
    }
    bumpVersion_();
    return { clearedTabs: cleared.clearedTabs, deletedEvents: cleared.deletedEvents, seeded };
  });
}

function opTestRead_(payload: Record<string, unknown>): unknown {
  const tab = asText_(payload["tab"]);
  headersFor_(tab); // throws on an unknown tab rather than returning an empty list
  return { rows: readRows_(tab).map((row) => row.values) };
}

function opTestWrite_(payload: Record<string, unknown>): unknown {
  const tab = asText_(payload["tab"]);
  const rows = asRowArray_(payload["rows"]);
  return withScriptLock_(() => {
    appendRows_(tab, rows);
    bumpVersion_();
    return { written: rows.length };
  });
}

/**
 * Overwrites rows matched on `keyField`, appending any that do not exist yet.
 *
 * Only the fields present in the supplied row are written; the rest of the row is left
 * alone. That is what lets a test blank one stamp without having to restate every column
 * and accidentally rewrite the ones it does not care about.
 */
function opTestUpdate_(payload: Record<string, unknown>): unknown {
  const tab = asText_(payload["tab"]);
  const keyField = asText_(payload["keyField"]);
  if (keyField === "") throw new Error("test.update requires a keyField.");
  const rows = asRowArray_(payload["rows"]);

  return withScriptLock_(() => {
    let updated = 0;
    let appended = 0;
    for (const row of rows) {
      const key = asText_(row[keyField]);
      const existing = findRow_(readRows_(tab), keyField, key);
      if (existing === null) {
        appendRows_(tab, [row]);
        appended += 1;
      } else {
        patchRow_(tab, existing, row);
        updated += 1;
      }
    }
    bumpVersion_();
    return { updated, appended };
  });
}

function opTestCalendarList_(payload: Record<string, unknown>): unknown {
  const now = Date.now();
  const fallback = calendarWindow_(now);
  const timeMin = parseIso_(payload["timeMin"]);
  const timeMax = parseIso_(payload["timeMax"]);
  const start = timeMin === null ? fallback.start : new Date(timeMin);
  const end = timeMax === null ? fallback.end : new Date(timeMax);

  const events = calendar_()
    .getEvents(start, end)
    .filter((event) => eventInstanceId_(event) !== "")
    .map((event) => ({
      eventId: event.getId(),
      instanceId: eventInstanceId_(event),
      title: event.getTitle(),
      startAt: event.getStartTime().toISOString(),
    }));
  return { events };
}

/**
 * Creates a tagged event with no matching row — the post-crash state `calendar.reconcile`
 * has to clean up. It goes through the same sender the sweep uses, so the manufactured
 * orphan is indistinguishable from a real one; an orphan built by hand a different way
 * would only prove reconcile can find events built by hand a different way.
 */
function opTestCalendarCreate_(payload: Record<string, unknown>): unknown {
  const instanceId = asText_(payload["instanceId"]);
  if (instanceId === "") throw new Error("test.calendar.create requires an instanceId.");
  const startAt = parseIso_(payload["startAt"]);
  if (startAt === null) throw new Error("test.calendar.create requires an ISO startAt.");

  const eventId = notificationSender_().send({
    instanceId,
    title: asText_(payload["title"]),
    body: "Created by the integration suite.",
    dueAt: startAt,
  });
  return { eventId };
}

function asRowArray_(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("Expected `rows` to be an array.");
  return value.map((entry) => {
    if (entry === null || typeof entry !== "object") throw new Error("Each row must be an object.");
    return entry as Record<string, unknown>;
  });
}
