import type { DomainCtx } from "../ctx.js";
import type { Chore } from "../model/Chore.js";
import type { RecurrenceUnit } from "../model/Recurrence.js";

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365;

/** A wall-clock reading in some zone. `month` is 1-12, matching how people say dates. */
interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * One formatter per zone. Building an Intl.DateTimeFormat is the expensive part, and the
 * due sweep calls this once per chore.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, made);
  return made;
}

/** The wall clock a person in `timeZone` reads off the wall at instant `ts`. */
function wallClockAt(ts: number, timeZone: string): WallClock {
  const found: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(ts))) {
    if (part.type !== "literal") found[part.type] = Number(part.value);
  }
  return {
    year: found["year"] ?? 1970,
    month: found["month"] ?? 1,
    day: found["day"] ?? 1,
    hour: (found["hour"] ?? 0) % 24,
    minute: found["minute"] ?? 0,
    second: found["second"] ?? 0,
  };
}

/**
 * How far ahead of UTC `timeZone` was at instant `ts`, in milliseconds. Positive for
 * New Zealand: +12h in standard time, +13h in daylight saving.
 */
function zoneOffsetAt(ts: number, timeZone: string): number {
  const w = wallClockAt(ts, timeZone);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // Sub-second precision is not part of the wall clock, so restore it from the instant.
  return asIfUtc - (ts - (((ts % 1000) + 1000) % 1000));
}

/**
 * The inverse of `wallClockAt`: the instant at which a person in `timeZone` reads this
 * wall clock. This is the piece a date library would normally supply.
 *
 * The offset depends on the answer, so it is solved by iteration: guess the offset from
 * the wall clock read as if it were UTC, then re-read it at the resulting instant. One
 * refinement is enough for every real zone, because offsets change by at most a couple
 * of hours and never twice within the same day. During a spring-forward gap the local
 * time does not exist and this lands on the instant just after the jump, which is the
 * behaviour we want for a chore: it becomes due as soon as that time would have arrived.
 */
function instantOf(w: WallClock, timeZone: string): number {
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const firstGuess = asIfUtc - zoneOffsetAt(asIfUtc, timeZone);
  return asIfUtc - zoneOffsetAt(firstGuess, timeZone);
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one, in UTC where there is no DST.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Add whole months on the calendar, clamping to the end of the target month. 31 January
 * plus one month is 28 February, or 29 February in a leap year — never 3 March. This is
 * the classic overflow bug, and it is why the day is clamped before the wall clock is
 * turned back into an instant.
 */
function addMonths(w: WallClock, months: number): WallClock {
  const zeroBased = w.year * 12 + (w.month - 1) + months;
  const year = Math.floor(zeroBased / 12);
  const month = (((zeroBased % 12) + 12) % 12) + 1;
  return { ...w, year, month, day: Math.min(w.day, daysInMonth(year, month)) };
}

/**
 * Add whole days on the calendar. Done on the date alone, with the time of day carried
 * across untouched, so the chore keeps its local time of day over a daylight saving
 * change rather than drifting an hour.
 */
function addDays(w: WallClock, days: number): WallClock {
  const rolled = new Date(Date.UTC(w.year, w.month - 1, w.day) + days * MS_PER_DAY);
  return {
    ...w,
    year: rolled.getUTCFullYear(),
    month: rolled.getUTCMonth() + 1,
    day: rolled.getUTCDate(),
  };
}

function step(w: WallClock, unit: RecurrenceUnit, n: number): WallClock {
  switch (unit) {
    case "day":
      return addDays(w, n);
    case "week":
      return addDays(w, n * 7);
    case "month":
      return addMonths(w, n);
    case "year":
      return addMonths(w, n * 12);
  }
}

/**
 * Every number that reaches the wall-clock arithmetic has to be finite, because a `NaN`
 * or `Infinity` gets all the way down to `new Date(...)` inside `Intl` and surfaces as a
 * bare `RangeError: Invalid time value` that names nothing. This runs as a sweep over
 * every chore on the server, so one malformed spreadsheet row would kill the whole sweep
 * and the log would not say which row. These throw instead with the function, the chore
 * and the offending field in the message, so the bad row is findable from the log alone.
 */
function checkFinite(fn: string, chore: Chore, field: string, value: number): void {
  if (Number.isFinite(value)) return;
  throw new Error(`${fn}: chore "${chore.id}": ${field} is not a finite number (${String(value)})`);
}

function checkRecurrence(fn: string, ctx: DomainCtx, lastDone: number, chore: Chore): void {
  checkFinite(fn, chore, "ctx.now", ctx.now);
  checkFinite(fn, chore, "lastDone timestamp", lastDone);
  const recurrence = chore.recurrence;
  if (recurrence === null) return;
  if (recurrence.kind === "interval") {
    checkFinite(fn, chore, `recurrence interval (${recurrence.unit})`, recurrence.n);
    return;
  }
  checkFinite(fn, chore, "recurrence timesPerYear", recurrence.timesPerYear);
}

// The next due date is derived, never stored on a Chore: a Chore holds recurrence
//  configuration, a ChoreInstance holds when one is due. DueSweep calls this when a
//  completion lands. An earlier advanceOnCompletion() was removed as redundant.
/**
 * When the next occurrence of `chore` falls due, given when it was last done.
 *
 * The arithmetic happens on the wall clock in `ctx.timeZone`, not on the raw timestamp,
 * so a chore due 09:00 local in March is still due 09:00 local in April after New
 * Zealand leaves daylight saving. Adding a fixed number of milliseconds would make it
 * 08:00, and every month after that would drift again.
 *
 * A chore with no recurrence has no next occurrence; the last-done instant is returned
 * unchanged so callers never see a nonsense date.
 */
export function nextDueFrom(ctx: DomainCtx, lastDone: number, chore: Chore): number {
  checkRecurrence("nextDueFrom", ctx, lastDone, chore);

  const recurrence = chore.recurrence;
  if (recurrence === null) return lastDone;

  const from = wallClockAt(lastDone, ctx.timeZone);

  if (recurrence.kind === "interval") {
    const n = Math.max(1, Math.trunc(recurrence.n));
    return instantOf(step(from, recurrence.unit, n), ctx.timeZone);
  }

  // "n times a year" splits the year into n equal slices. Four times a year is every
  // three months; five times a year is every 73 days, because five does not divide the
  // calendar into whole months.
  const times = Math.max(1, Math.trunc(recurrence.timesPerYear));
  const next =
    12 % times === 0
      ? addMonths(from, 12 / times)
      : addDays(from, Math.max(1, Math.round(DAYS_PER_YEAR / times)));
  return instantOf(next, ctx.timeZone);
}
