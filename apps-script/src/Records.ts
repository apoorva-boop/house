// The one place a spreadsheet row becomes a domain value. A SCRIPT, not a module.
//
// Rows are strings; the domain speaks numbers, epoch millis and tagged unions. Keeping
// every conversion here means a schema change is one edit, and — more to the point —
// means no rule ever sees a raw cell. A `Date.parse` scattered through the sweep is how
// a corrupt cell turns into a NaN that silently disables a gate.

/** A `Chores` row as the domain rules want it. `null` fields mean "not configured". */
function choreFromRow_(row: SheetRow): DomainChore {
  const values = row.values;
  const leadTimeDays = asText_(values["leadTimeDays"]);
  const deadlineDate = asText_(values["deadlineDate"]);
  return {
    id: asText_(values["id"]),
    title: asText_(values["title"]),
    assetId: asText_(values["assetId"]),
    weight: {
      time: asNumber_(values["weightTime"], 1),
      effort: asNumber_(values["weightEffort"], 1),
      priority: asNumber_(values["weightPriority"], 1),
    },
    recurrence: recurrenceFromRow_(row),
    deadlineDate: deadlineDate === "" ? null : deadlineDate,
    leadTimeDays: leadTimeDays === "" ? null : asNumber_(leadTimeDays, 0),
    urgencyCurve: null,
  };
}

/**
 * `recurrenceUnit` doubles as the discriminant: one of the four interval units, or the
 * literal "timesPerYear". Anything else — including a blank — is a one-off chore with no
 * next occurrence, and the rules handle that by returning the last-done instant.
 */
function recurrenceFromRow_(row: SheetRow): DomainChore["recurrence"] {
  const unit = asText_(row.values["recurrenceUnit"]);
  const n = asNumber_(row.values["recurrenceN"], 0);
  if (n <= 0) return null;
  if (unit === "timesPerYear") return { kind: "timesPerYear", timesPerYear: n };
  if (unit === "day" || unit === "week" || unit === "month" || unit === "year") {
    return { kind: "interval", unit, n };
  }
  return null;
}

/** An `Instances` row as the domain rules want it. */
function instanceFromRow_(row: SheetRow, nowMs: number): DomainInstance {
  const dueAt = parseIso_(row.values["dueAt"]);
  const dueMs = dueAt === null ? nowMs : dueAt;
  const calendarEventId = asText_(row.values["calendarEventId"]);
  return {
    instanceId: asText_(row.values["instanceId"]),
    choreId: asText_(row.values["choreId"]),
    dueAt: dueMs,
    overdueDays: Math.max(0, Math.floor((nowMs - dueMs) / 86_400_000)),
    calendarEventId: calendarEventId === "" ? null : calendarEventId,
    lastNotifiedAt: parseIso_(row.values["lastNotifiedAt"]),
    snoozedUntil: parseIso_(row.values["snoozedUntil"]),
  };
}

/** Chores that have not been soft-deleted, indexed by id. */
function liveChoresById_(): Record<string, SheetRow> {
  const index: Record<string, SheetRow> = {};
  for (const row of readRows_("Chores")) {
    if (asText_(row.values["deletedAt"]) !== "") continue;
    index[asText_(row.values["id"])] = row;
  }
  return index;
}

function findLiveChore_(choreId: string): SheetRow | null {
  const found = liveChoresById_()[choreId];
  return found === undefined ? null : found;
}
