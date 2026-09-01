import type { Chore, ChoreWeight } from "../model/Chore.js";
import type { Recurrence, RecurrenceUnit } from "../model/Recurrence.js";

/**
 * The starting chore list.
 *
 * Setting this app up by hand is thirty forms, and a setup that costs thirty forms does
 * not get finished — so the list ships filled in. Every slider already carries a value
 * that is roughly right for a New Zealand house, and every one of them is meant to be
 * argued with and edited. The seed's job is to make the first screen a list you tweak
 * rather than a blank page you abandon.
 *
 * Ids are stable slugs, not UUIDs. A seeded chore is the same chore on every device, so
 * two people setting up the same house do not end up with two "Mow the lawns".
 */

/** `{time, effort, priority}`, each on the 1-5 integer domain. */
function w(time: number, effort: number, priority: number): ChoreWeight {
  return { time, effort, priority };
}

function every(n: number, unit: RecurrenceUnit): Recurrence {
  return { kind: "interval", unit, n };
}

function perYear(timesPerYear: number): Recurrence {
  return { kind: "timesPerYear", timesPerYear };
}

function recurring(id: string, title: string, assetId: string, weight: ChoreWeight, recurrence: Recurrence): Chore {
  return { id, title, assetId, weight, recurrence, deadlineDate: null, leadTimeDays: null, urgencyCurve: null };
}

/**
 * A chore with a fixed legal date rather than an interval — a warrant, a registration.
 *
 * `leadTimeDays` is how long before the date it starts mattering, and doubles as the
 * severity cap once the date has passed. `deadlineDate` here is a placeholder: the setup
 * screen asks for the real one, because nobody else's warrant is due on the same day.
 * A far-future placeholder is deliberate — a seeded date in the past would open the app
 * on a car that is already broken down, which teaches people to ignore the colour.
 */
function deadline(
  id: string,
  title: string,
  assetId: string,
  weight: ChoreWeight,
  deadlineDate: string,
  leadTimeDays: number,
  urgencyCurve: "linear" | "steep",
): Chore {
  return { id, title, assetId, weight, recurrence: null, deadlineDate, leadTimeDays, urgencyCurve };
}

const HOUSE: readonly Chore[] = [
  recurring("house-rubbish", "Put the rubbish and recycling out", "house", w(1, 1, 5), every(1, "week")),
  recurring("house-vacuum", "Vacuum the floors", "house", w(3, 3, 4), every(1, "week")),
  recurring("house-kitchen", "Wipe down the kitchen benches", "house", w(2, 2, 4), every(2, "day")),
  recurring("house-bathroom", "Clean the bathroom", "house", w(3, 3, 4), every(1, "week")),
  recurring("house-mop", "Mop the hard floors", "house", w(3, 3, 3), every(2, "week")),
  recurring("house-sheets", "Change the bed sheets", "house", w(2, 2, 4), every(2, "week")),
  recurring("house-shower", "Scrub the shower", "house", w(3, 4, 3), every(2, "week")),
  recurring("house-dust", "Dust the surfaces and skirtings", "house", w(3, 2, 2), every(1, "month")),
  recurring("house-fridge", "Clear out and wipe the fridge", "house", w(3, 3, 3), every(1, "month")),
  recurring("house-drains", "Clear the shower and sink drains", "house", w(2, 3, 3), every(1, "month")),
  recurring("house-rangehood", "Degrease the rangehood filter", "house", w(2, 3, 3), perYear(4)),
  recurring("house-oven", "Clean the oven", "house", w(4, 5, 2), perYear(4)),
  recurring("house-heatpump", "Wash the heat pump filters", "house", w(2, 2, 4), perYear(2)),
  recurring("house-windows", "Clean the windows inside and out", "house", w(4, 4, 2), perYear(2)),
  recurring("house-smoke-alarms", "Test the smoke alarms", "house", w(1, 1, 5), perYear(2)),
  recurring("house-hot-water", "Check the hot water cylinder valve", "house", w(1, 2, 4), every(1, "year")),
];

const GARDEN: readonly Chore[] = [
  recurring("garden-water-pots", "Water the pots and seedlings", "garden", w(1, 1, 3), every(3, "day")),
  recurring("garden-mow", "Mow the lawns", "garden", w(3, 4, 4), every(2, "week")),
  recurring("garden-edges", "Trim the lawn edges", "garden", w(2, 3, 2), every(1, "month")),
  recurring("garden-weeds", "Weed the garden beds", "garden", w(3, 3, 3), every(1, "month")),
  recurring("garden-paths", "Sweep the deck and paths", "garden", w(2, 2, 2), every(1, "month")),
  recurring("garden-compost", "Turn and empty the compost", "garden", w(2, 3, 2), perYear(4)),
  recurring("garden-hedges", "Prune the hedges", "garden", w(4, 4, 2), perYear(3)),
  recurring("garden-gutters", "Clear the gutters", "garden", w(3, 4, 5), perYear(2)),
  recurring("garden-lawn-feed", "Feed the lawn", "garden", w(2, 2, 2), perYear(2)),
  recurring("garden-waterblast", "Water blast the drive and deck", "garden", w(4, 4, 2), every(1, "year")),
];

const CAR: readonly Chore[] = [
  recurring("car-tyre-pressure", "Check the tyre pressures", "car", w(1, 1, 4), every(1, "month")),
  recurring("car-oil", "Check the oil and coolant", "car", w(1, 1, 4), every(1, "month")),
  recurring("car-wash", "Wash the car", "car", w(3, 3, 2), every(1, "month")),
  recurring("car-washer-fluid", "Top up the washer fluid", "car", w(1, 1, 3), perYear(4)),
  recurring("car-interior", "Vacuum out the inside", "car", w(2, 3, 2), perYear(4)),
  recurring("car-tyre-tread", "Check the tyre tread and spare", "car", w(1, 1, 5), perYear(2)),
  recurring("car-service", "Book the car in for a service", "car", w(2, 2, 5), every(1, "year")),
  deadline("car-wof", "Warrant of fitness", "car", w(3, 2, 5), "2027-03-31", 30, "steep"),
  deadline("car-rego", "Registration renewal", "car", w(1, 1, 5), "2027-01-31", 21, "linear"),
];

/** A fresh copy every call, so a caller editing the list cannot mutate the seed. */
export function defaultChores(): Chore[] {
  return [...HOUSE, ...GARDEN, ...CAR].map((c) => ({ ...c, weight: { ...c.weight } }));
}

/**
 * How much the first week's points are worth.
 *
 * Week one is the catch-up sprint: the house is opened for the first time, everything is
 * overdue at once, and the backlog is the exact moment a person decides the app is
 * hopeless and stops. Paying one and a half times for that week's work makes clearing a
 * neglected house the best-scoring week there is.
 */
export const WEEK_ONE_MULTIPLIER = 1.5;

/** `points` during the catch-up sprint. Non-finite or negative input scores nothing. */
export function weekOneBonus(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.round(points * WEEK_ONE_MULTIPLIER);
}
