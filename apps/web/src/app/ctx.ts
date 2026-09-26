import type { DomainCtx } from "@house/domain";

export type Clock = () => number;

/**
 * The phone's own zone. A fallback, not the answer.
 *
 * Two devices in one household can resolve different zones — a phone still set to the
 * last place someone flew back from is enough — and then the same chore reads overdue on
 * one and not on the other, because every domain rule does its date arithmetic in the
 * zone it is handed.
 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The zone to do date arithmetic in: the household's, from the snapshot's `Meta` row,
 * and the browser's only when the snapshot does not carry one.
 *
 * The fallback is for a deployment older than the server change that added the field,
 * where the choice is between the phone's zone and no app at all.
 */
export function householdTimeZone(fromSnapshot: string | undefined): string {
  return fromSnapshot !== undefined && fromSnapshot !== "" ? fromSnapshot : browserTimeZone();
}

export function makeCtx(now: Clock, timeZone: string): DomainCtx {
  return { now: now(), timeZone };
}
