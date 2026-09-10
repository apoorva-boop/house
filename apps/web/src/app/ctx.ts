import type { DomainCtx } from "@house/domain";

export type Clock = () => number;

/**
 * The time zone comes from the browser, not from the household. The deployed
 * snapshot carries no `Meta` row yet, so there is nowhere else to read it from — see
 * the contract's "Known gaps".
 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function makeCtx(now: Clock, timeZone: string): DomainCtx {
  return { now: now(), timeZone };
}
