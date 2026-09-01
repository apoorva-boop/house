// Seeding a fresh household: the dates come from the SERVER'S clock, not from a literal.
//
// ---------------------------------------------------------------------------
// The bug these tests exist to stop coming back
// ---------------------------------------------------------------------------
// `packages/domain/src/seed/defaultChores.ts` ships `car-wof` at 2027-03-31 and
// `car-rego` at 2027-01-31. Those are literals, and they had to be: the domain package
// is forbidden a clock by `purity.test.ts` and by `eslint.config.js`, so it cannot say
// "about six weeks from now". A literal goes stale, and from early 2027 a fresh install
// would open on a car that is already overdue — the app's very first screen teaching the
// household that the colours mean nothing.
//
// `apps-script/src/Seed.ts` is the fix: it takes the LIST from the domain and computes
// every deadline itself, from `Date.now()` on the server, at the moment setup runs. So
// the assertion below is deliberately not "the WOF is due on date X". It is "whatever
// date the WOF is on, it is ahead of the server's own clock and it is not 2027-03-31" —
// which is true today, is still true in 2028, and fails the moment somebody makes the
// server pass `deadlineDate` straight through again.
//
// ---------------------------------------------------------------------------
// Why the calendar assertions matter as much as the sheet ones
// ---------------------------------------------------------------------------
// Google Calendar is the authority on WHEN a chore is due (see the header of
// `calendarauthority.test.ts`). A seeded date that exists only in a spreadsheet cell is
// a date nobody can see and nobody can drag, so it would never get corrected to the real
// warrant date — which is the whole reason a placeholder is acceptable at all. The event
// existing, at the same instant the row claims, is therefore part of the fix and not a
// bonus.
//
// ---------------------------------------------------------------------------
// Why seeding runs on a PERSON token
// ---------------------------------------------------------------------------
// `household.seed` is a production op, not a `test.*` one, and it is deliberately absent
// from `TEST_ALLOWED_OPS_` in `Auth.ts`. Widening the test token's reach to save a line
// here would weaken the real deployment, so these tests send `personA.token` the way the
// app will.

import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  call,
  clearAll,
  listAllCalendar,
  readTab,
  requireIntegrationEnv,
  seedHousehold,
  TEST_TIMEOUT_MS,
  type Household,
  type Row,
} from "./testkit.js";

/** What `household.seed` answers with. Ids only — the caller re-reads for the rest. */
interface SeedData {
  chores?: string[];
  assets?: string[];
  scheduled?: string[];
}

/** The two deadline chores in the domain seed, and the literals they must NOT carry. */
const WOF_ID = "car-wof";
const REGO_ID = "car-rego";
const STALE_DEADLINES: Record<string, string> = {
  [WOF_ID]: "2027-03-31",
  [REGO_ID]: "2027-01-31",
};

function rowById(rows: Row[], id: string): Row {
  const found = rows.find((row) => String(row.id) === id);
  if (!found) throw new Error(`No Chores row for "${id}". Got ${rows.length} rows.`);
  return found;
}

function msOf(value: unknown, what: string): number {
  const ms = Date.parse(String(value ?? ""));
  expect(Number.isFinite(ms), `${what}: "${String(value)}" is not a readable instant`).toBe(true);
  return ms;
}

describe("seeding a fresh household dates the chores from the server's clock", () => {
  let household: Household;

  beforeAll(() => {
    requireIntegrationEnv();
  });

  beforeEach(async () => {
    await clearAll();
    household = await seedHousehold();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await clearAll();
  }, TEST_TIMEOUT_MS);

  it(
    "gives every deadline chore a future date, and never the 2027 literals",
    async () => {
      const before = Date.now();
      const seeded = await call<SeedData>("household.seed", {}, { token: household.personA.token });
      expect(seeded.ok, `household.seed failed: ${seeded.error ?? ""}`).toBe(true);

      const chores = await readTab("Chores");
      expect(chores.length).toBeGreaterThan(30);

      // Every deadline chore in the seed, found by having a deadlineDate at all rather
      // than by id, so a third one added to the domain seed is covered automatically.
      const deadlineRows = chores.filter((row) => String(row.deadlineDate ?? "") !== "");
      expect(deadlineRows.length).toBeGreaterThanOrEqual(2);

      for (const row of deadlineRows) {
        const id = String(row.id);
        const stale = STALE_DEADLINES[id];
        if (stale !== undefined) {
          expect(String(row.deadlineDate), `${id} still carries the domain seed's literal`).not.toBe(
            stale,
          );
        }
        // The row's own due date is the one the sweep and the calendar read.
        const dueMs = msOf(row.nextDueAt, `${id} nextDueAt`);
        expect(dueMs, `${id} was seeded in the past`).toBeGreaterThan(before);
        // 2027-03-31 is a fixed instant; a computed offset from "now" cannot land on it.
        expect(new Date(dueMs).getUTCFullYear()).toBeGreaterThanOrEqual(
          new Date(before).getUTCFullYear(),
        );
      }

      // Both named chores are present and are among them.
      const wof = rowById(chores, WOF_ID);
      const rego = rowById(chores, REGO_ID);
      expect(String(wof.deadlineDate)).not.toBe(STALE_DEADLINES[WOF_ID]);
      expect(String(rego.deadlineDate)).not.toBe(STALE_DEADLINES[REGO_ID]);

      // The WOF's lead time is 30 days and the rego's is 21, so a seeded deadline sitting
      // INSIDE its own lead-time window would mean the app opens on a car already going
      // amber — the failure the placeholder exists to avoid.
      const wofLead = Number(wof.leadTimeDays ?? 0);
      expect(wofLead).toBeGreaterThan(0);
      expect(
        msOf(wof.nextDueAt, "car-wof nextDueAt") - before,
        "car-wof was seeded inside its own lead-time window",
      ).toBeGreaterThan(wofLead * 86_400_000);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "puts a calendar event on each seeded deadline, at the date the row claims",
    async () => {
      const seeded = await call<SeedData>("household.seed", {}, { token: household.personA.token });
      expect(seeded.ok, `household.seed failed: ${seeded.error ?? ""}`).toBe(true);

      const chores = await readTab("Chores");
      const instances = await readTab("Instances");
      const events = await listAllCalendar();

      for (const id of [WOF_ID, REGO_ID]) {
        const chore = rowById(chores, id);
        const open = instances.filter((row) => String(row.choreId) === id);
        expect(open, `${id} has no open occurrence`).toHaveLength(1);

        const instance = open[0];
        const instanceId = String(instance.instanceId);
        expect(String(instance.calendarEventId), `${id} has no calendar event id`).not.toBe("");

        const mine = events.filter((event) => event.instanceId === instanceId);
        expect(mine, `${id} has no calendar event`).toHaveLength(1);

        // Row and event agree. One minute of slack, because Google stores an event time
        // to the second while the row stores milliseconds — the same tolerance
        // `calendarDriftToleranceMs_` uses for exactly this reason.
        const rowMs = msOf(chore.nextDueAt, `${id} nextDueAt`);
        const eventMs = msOf(mine[0].startAt, `${id} event startAt`);
        expect(
          Math.abs(eventMs - rowMs),
          `${id}: event at ${String(mine[0].startAt)} but row says ${String(chore.nextDueAt)}`,
        ).toBeLessThanOrEqual(60_000);
      }

      // Recurring chores are seeded due NOW and are materialised by the sweep, not here,
      // so seeding creates exactly the deadline events and no others.
      expect(events).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "seeds nothing the second time: no duplicate chores and no duplicate events",
    async () => {
      const first = await call<SeedData>("household.seed", {}, { token: household.personA.token });
      expect(first.ok, `first household.seed failed: ${first.error ?? ""}`).toBe(true);

      const choresAfterFirst = await readTab("Chores");
      const eventsAfterFirst = await listAllCalendar();
      const instancesAfterFirst = await readTab("Instances");
      expect(choresAfterFirst.length).toBeGreaterThan(30);

      const second = await call<SeedData>("household.seed", {}, { token: household.personA.token });
      expect(second.ok, `second household.seed failed: ${second.error ?? ""}`).toBe(true);
      // The second call reports that it wrote nothing, which is a stronger statement than
      // the counts below: it says the op decided to skip, rather than that something else
      // happened to clean up after it.
      expect(second.data?.chores ?? []).toHaveLength(0);
      expect(second.data?.scheduled ?? []).toHaveLength(0);
      expect(second.data?.assets ?? []).toHaveLength(0);

      const choresAfterSecond = await readTab("Chores");
      const eventsAfterSecond = await listAllCalendar();
      const instancesAfterSecond = await readTab("Instances");

      expect(choresAfterSecond).toHaveLength(choresAfterFirst.length);
      expect(instancesAfterSecond).toHaveLength(instancesAfterFirst.length);
      expect(eventsAfterSecond).toHaveLength(eventsAfterFirst.length);

      // Every id appears exactly once. A length check alone would pass if the op replaced
      // one chore with a duplicate of another.
      const ids = choresAfterSecond.map((row) => String(row.id));
      expect(new Set(ids).size).toBe(ids.length);

      // The events are the SAME events, not replacements sitting on the same dates.
      const idsBefore = eventsAfterFirst.map((event) => event.eventId).sort();
      const idsAfter = eventsAfterSecond.map((event) => event.eventId).sort();
      expect(idsAfter).toEqual(idsBefore);
    },
    TEST_TIMEOUT_MS,
  );
});
