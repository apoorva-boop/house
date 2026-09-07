// Seeding a fresh household. A SCRIPT, not a module.
//
// ---------------------------------------------------------------------------
// Two copies of every seed date. THIS ONE WINS.
// ---------------------------------------------------------------------------
// The chore LIST comes from `packages/domain/src/seed/defaultChores.ts`, reached here as
// `Domain.defaultChores()`. There is one list and it is not restated on this side.
//
// The DATES on that list are placeholders, and this file overrides every one of them.
// `defaultChores()` hardcodes `car-wof` at 2027-03-31 and `car-rego` at 2027-01-31. It
// has no choice: `packages/domain/src/purity.test.ts` and the clock rules in
// `eslint.config.js` refuse any `Date.now()` or `new Date()` inside that package, so a
// seed that means "about six weeks from now" cannot be written there at all. A literal
// is the only thing a pure module can hold, and a literal goes stale — from early 2027 a
// fresh install would open on a car that is already overdue, which is the exact failure
// that seed's own docstring warns about.
//
// So the date is computed HERE, at seeding time, from the server's own clock. If you go
// looking and find two dates for the same chore, the one in `defaultChores()` reaches
// nothing: `seedChoreRow_` below never copies `deadlineDate` through. What lands in the
// sheet, and what lands on the calendar, is what this file works out.
//
// That split is only tolerable because Google Calendar is the authority on WHEN a chore
// is due (see the header of `calendarauthority.test.ts`). The seeded date is a starting
// hint that the household is expected to drag to the real one; the calendar event this
// file creates is the thing that actually holds it afterwards.
//
// ---------------------------------------------------------------------------
// Seeding twice is harmless
// ---------------------------------------------------------------------------
// Chore ids are stable slugs, not UUIDs, so "have I already seeded this?" is decidable
// from the sheet with no marker row and no flag. A chore id that already has a row is
// skipped — INCLUDING a soft-deleted one, because a chore the household has deliberately
// retired must not walk back in on the next call. Only genuinely new chores are written,
// and only genuinely new chores get an event.

// ---------------------------------------------------------------------------
// The offsets
// ---------------------------------------------------------------------------

/**
 * A function rather than a top-level `const`, for the reason spelled out in the header
 * of `Config.ts`: nothing in this server may be read out of another file's top-level
 * binding before that file has been evaluated, and Apps Script promises no load order.
 */
function msPerDay_(): number {
  return 86_400_000;
}

/**
 * How far OUTSIDE its own lead-time window a seeded deadline is placed. Fourteen days.
 *
 * The offset is measured from `leadTimeDays` rather than being a flat number, because
 * `leadTimeDays` is also the point at which a deadline chore starts colouring the car.
 * A flat 30 days would put the warrant of fitness — lead time 30 — exactly on that
 * boundary, so a fresh install would open on a car that is already going amber. Placing
 * it a fortnight clear of its own window means the app opens quiet, and then the chore
 * surfaces about two weeks later.
 *
 * Two weeks, not two months, on purpose. The seeded date is WRONG — nobody's warrant is
 * due on a date derived from when they installed an app — and the only thing that gets
 * it fixed is Apoorva seeing it and dragging the event to the real date. A placeholder
 * six months out is a placeholder nobody ever corrects.
 *
 * Concretely, for the two deadline chores the seed ships with:
 *   car-wof    lead time 30  ->  44 days from setup
 *   car-rego   lead time 21  ->  35 days from setup
 *
 * Both are obviously arbitrary, which is the point: a date 44 days out reads as "someone
 * has to fix this", where 31 March reads as a real answer.
 */
function seedDeadlineClearanceDays_(): number {
  return 14;
}

/** The offset for a deadline chore that carries no lead time. */
function seedDeadlineFallbackDays_(): number {
  return 30;
}

/**
 * The placeholder deadline for one chore, as epoch millis.
 *
 * The time of day is whatever time of day setup ran at. That is deliberate rather than
 * overlooked: snapping to a fixed local hour needs time-zone arithmetic, and the value
 * is a placeholder the household is being asked to drag anyway.
 */
function seedDeadlineMs_(nowMs: number, chore: DomainChore): number {
  const lead = chore.leadTimeDays;
  const days =
    lead === null || !Number.isFinite(lead) || lead <= 0
      ? seedDeadlineFallbackDays_()
      : lead + seedDeadlineClearanceDays_();
  return nowMs + days * msPerDay_();
}

/** `YYYY-MM-DD` in the household's zone, matching the shape the domain seed uses. */
function seedDeadlineDate_(ms: number): string {
  return Utilities.formatDate(new Date(ms), householdTimeZone_(), "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * One `Chores` row from one domain chore.
 *
 * `nextDueAt` differs by kind, and both answers are deliberate:
 *
 *   deadline   the computed placeholder above. A future date, so the sweep leaves it
 *              alone; `opHouseholdSeed_` puts the event on it directly instead, because
 *              a date the household cannot see is a date it cannot correct.
 *   recurring  now. Week one is the catch-up sprint the domain seed's
 *              `WEEK_ONE_MULTIPLIER` exists for — the house is opened for the first
 *              time, everything is overdue at once, and clearing it is the best-scoring
 *              week there is. The next sweep materialises them and puts them on the
 *              calendar; nothing is scheduled from here.
 */
function seedChoreRow_(
  nowMs: number,
  chore: DomainChore,
  assetId: string,
): Record<string, unknown> {
  const recurrence = chore.recurrence;
  const isDeadline = recurrence === null && chore.deadlineDate !== null;
  const deadlineMs = isDeadline ? seedDeadlineMs_(nowMs, chore) : null;

  return {
    id: chore.id,
    title: chore.title,
    assetId,
    weightTime: chore.weight.time,
    weightEffort: chore.weight.effort,
    weightPriority: chore.weight.priority,
    recurrenceUnit: recurrence === null ? "" : recurrence.kind === "timesPerYear" ? "timesPerYear" : recurrence.unit,
    recurrenceN: recurrence === null ? "" : recurrence.kind === "timesPerYear" ? recurrence.timesPerYear : recurrence.n,
    nextDueAt: toIso_(deadlineMs === null ? nowMs : deadlineMs),
    deadlineDate: deadlineMs === null ? "" : seedDeadlineDate_(deadlineMs),
    leadTimeDays: chore.leadTimeDays === null ? "" : chore.leadTimeDays,
    deletedAt: "",
  };
}

/**
 * The asset id each seeded chore should point at, keyed by the kind slug the domain seed
 * uses (`house`, `garden`, `car`).
 *
 * An existing asset of that kind WINS, whatever its id is. A household that already has
 * an `Assets` row for the car — because a person set it up by hand, or because the test
 * suite seeded one — must not end up with a second car sitting beside it holding all the
 * car chores. Only a kind with no row at all gets one, and it gets the slug as its id so
 * the row is readable in the spreadsheet.
 *
 * The kinds are read off the chores rather than listed here, so adding a fourth asset to
 * the domain seed needs no edit on this side.
 */
function seedAssetIds_(chores: DomainChore[]): { byKind: Record<string, string>; created: string[] } {
  const byKind: Record<string, string> = {};
  for (const row of readRows_("Assets")) {
    const kind = asText_(row.values["kind"]);
    const id = asText_(row.values["id"]);
    if (kind === "" || id === "") continue;
    if (byKind[kind] === undefined) byKind[kind] = id;
  }

  const fresh: Record<string, unknown>[] = [];
  const created: string[] = [];
  for (const chore of chores) {
    const kind = chore.assetId;
    if (kind === "" || byKind[kind] !== undefined) continue;
    const budget = Domain.DEFAULT_BUDGETS[kind];
    byKind[kind] = kind;
    created.push(kind);
    fresh.push({ id: kind, kind, budget: budget === undefined ? 0 : budget });
  }
  appendRows_("Assets", fresh);

  return { byKind, created };
}

// ---------------------------------------------------------------------------
// The op
// ---------------------------------------------------------------------------

/**
 * Fills a household's `Assets` and `Chores` tabs from the domain seed, and puts each
 * seeded deadline chore on the calendar at a date computed from this server's clock.
 *
 * Everything runs inside the script lock and the version is bumped once at the end, so
 * two phones tapping "set up my house" at the same moment cannot interleave and produce
 * two copies of the list.
 */
function opHouseholdSeed_(): unknown {
  const nowMs = Date.now();

  return withScriptLock_(() => {
    const chores = Domain.defaultChores();
    const assets = seedAssetIds_(chores);

    // Every id already on the sheet, soft-deleted rows included. A chore the household
    // retired stays retired.
    const existing: Record<string, true> = {};
    for (const row of readRows_("Chores")) existing[asText_(row.values["id"])] = true;

    const fresh: Record<string, unknown>[] = [];
    const seeded: Record<string, true> = {};
    const seededIds: string[] = [];
    for (const chore of chores) {
      if (existing[chore.id] === true) continue;
      const assetId = assets.byKind[chore.assetId];
      fresh.push(seedChoreRow_(nowMs, chore, assetId === undefined ? chore.assetId : assetId));
      seeded[chore.id] = true;
      seededIds.push(chore.id);
    }
    appendRows_("Chores", fresh);

    // Deadline chores only. Their `nextDueAt` is in the future, so the sweep will not
    // materialise them for weeks, and until it does the placeholder date would exist
    // only in a spreadsheet cell — a date nobody can see and nobody can drag. Recurring
    // chores need none of this: they are seeded due now and the next sweep schedules
    // them through the same path every other occurrence goes through.
    const scheduled: string[] = [];
    if (seededIds.length > 0) {
      const rows = liveChoresById_();
      for (const chore of chores) {
        if (seeded[chore.id] !== true) continue;
        if (chore.recurrence !== null || chore.deadlineDate === null) continue;
        const row = rows[chore.id];
        if (row === undefined) continue;
        scheduled.push(
          scheduleOccurrenceAt_(
            row,
            chore.id,
            seedDeadlineMs_(nowMs, chore),
            "Placeholder date from setup — it is almost certainly wrong. " +
              "Drag this event to the real one and the app will follow it.",
          ),
        );
      }
    }

    bumpVersion_();
    return { chores: seededIds, assets: assets.created, scheduled };
  });
}
