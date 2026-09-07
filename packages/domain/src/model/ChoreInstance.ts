export interface ChoreInstance {
  readonly instanceId: string;
  readonly choreId: string;
  readonly dueAt: number;
  readonly overdueDays: number;
  readonly calendarEventId: string | null;
  readonly lastNotifiedAt: number | null;
  readonly snoozedUntil: number | null;
}
