import type { DomainCtx } from "../ctx.js";
import type { ChoreInstance } from "../model/ChoreInstance.js";

const MS_PER_HOUR = 3_600_000;

export interface NotifyPolicy {
  /**
   * How often to re-alert about a chore that is still overdue, in hours. `null` is the
   * default and means "tell us once" — no daily nagging unless someone opts in.
   */
  readonly repeatEveryHours: number | null;
}

/**
 * Whether this overdue chore instance is allowed to raise an alert right now.
 *
 * Four gates, in order of how loudly they say no:
 * 1. Snoozed. Someone asked for silence until a time that has not arrived yet.
 * 2. Not overdue. Nothing is due to be said about a chore that still has time on it.
 * 3. Never told. The first alert always goes out.
 * 4. Already told. Silence unless repeat reminders are on and the interval has elapsed.
 *
 * The caller is responsible for recording `lastNotifiedAt` once it actually delivers, so
 * a second sweep over the same window does not send the same reminder twice.
 *
 * Timestamps read back off the sheet can be `NaN` when a cell is corrupt, so every one is
 * checked with `Number.isFinite` rather than left to NaN comparison semantics. A corrupt
 * timestamp is treated as absent, which fails towards telling someone: a stray reminder
 * is an annoyance, silence about a chore nobody is tracking is the failure that costs a
 * roof. So an unreadable `snoozedUntil` does not silence, and an unreadable
 * `lastNotifiedAt` reads as "never told" and lets the first alert through.
 */
export function eligible(ctx: DomainCtx, instance: ChoreInstance, policy: NotifyPolicy): boolean {
  const snoozedUntil =
    instance.snoozedUntil !== null && Number.isFinite(instance.snoozedUntil)
      ? instance.snoozedUntil
      : null;
  const lastNotifiedAt =
    instance.lastNotifiedAt !== null && Number.isFinite(instance.lastNotifiedAt)
      ? instance.lastNotifiedAt
      : null;

  if (snoozedUntil !== null && snoozedUntil > ctx.now) return false;
  if (ctx.now < instance.dueAt) return false;
  if (lastNotifiedAt === null) return true;

  const repeat = policy.repeatEveryHours;
  if (repeat === null || !Number.isFinite(repeat) || repeat <= 0) return false;
  return ctx.now - lastNotifiedAt >= repeat * MS_PER_HOUR;
}

/**
 * Silence this instance's alerts for `hours` from now.
 *
 * `dueAt` and `overdueDays` are deliberately left alone. Snoozing quiets the reminder;
 * it does not stop the chore being late, and the house keeps degrading while it is
 * snoozed. Letting a snooze move the due date would turn the alert dismissal into a way
 * of cheating the game.
 *
 * Returns a new instance — the old one stays valid for callers holding it.
 *
 * `hours` must be a finite number and `ctx.now` a finite instant. `Math.max(0, NaN)` is
 * `NaN`, so a non-finite input used to produce a `NaN` `snoozedUntil`, which `eligible`
 * then read as "not snoozed" and alerted on immediately — a snooze that silently
 * un-snoozes. That is a caller bug, not a state the house can be in, so it throws rather
 * than guessing. A negative `hours` is harmless and clamps to 0: a snooze that has
 * already expired, which is exactly what "snooze me for -3 hours" can only mean.
 */
export function snooze(ctx: DomainCtx, instance: ChoreInstance, hours: number): ChoreInstance {
  if (!Number.isFinite(hours)) {
    throw new Error(`snooze: hours must be a finite number, got ${String(hours)}`);
  }
  if (!Number.isFinite(ctx.now)) {
    throw new Error(`snooze: ctx.now must be a finite timestamp, got ${String(ctx.now)}`);
  }
  return { ...instance, snoozedUntil: ctx.now + Math.max(0, hours) * MS_PER_HOUR };
}
