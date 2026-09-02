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
// That gate is not belt-and-braces. `test.clear` wipes every data tab and deletes every
// event this server put on the calendar. Guarding it with a token alone would leave a data-wiping
// endpoint live on a public URL for as long as the deployment exists, one leaked string
// away from erasing a household's history. A property only a human can set, in a project
// only Apoorva owns, is the difference between "hard to reach" and "not present".

/** `Meta` keys that are configuration, not test data. Survive `test.clear`. */
function metaConfigKeys_(): string[] {
  return ["calendarId"];
}

/**
 * Wipes every data tab, and every event on the calendar THIS SERVER CREATED.
 *
 * `calendarId` is preserved. It is the deployment's configuration, not a fixture: the
 * suite never writes it, so clearing it would leave the server unable to find the
 * calendar for the rest of the run — and "find the calendar" is not a thing to get wrong
 * by default, because the wrong answer is somebody's real calendar. Nothing in the suite
 * reads `Meta`, so the surviving row is invisible to it.
 */
function opTestClear_(): unknown {
  return withScriptLock_(() => {
    const config = metaConfigKeys_();
    const preserved: Record<string, unknown>[] = [];
    for (const row of readRows_("Meta")) {
      if (config.indexOf(asText_(row.values["key"])) !== -1) preserved.push({ ...row.values });
    }

    for (const tab of tabNames_()) clearTab_(tab);
    appendRows_("Meta", preserved);

    let deletedEvents = 0;
    if (calendarId_() !== "") {
      // Only events this server created, found by the same tag `reconcileCalendar_` keys
      // on. The unfiltered listing this replaced deleted everything in the window,
      // including events a person had put there by hand — so a `CALENDAR_ID` pointed one
      // character wrong, at somebody's real diary, would have emptied thirteen months of
      // it on the next `clearAll()`. An untagged event is not ours to delete, ever.
      for (const event of taggedEvents_(Date.now())) {
        event.deleteEvent();
        deletedEvents += 1;
      }
    }

    bumpVersion_();
    return { clearedTabs: tabNames_(), deletedEvents };
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
