export interface Completion {
  readonly mutationId: string;
  readonly instanceId: string;
  readonly choreId: string;
  readonly personId: string;
  readonly completedAt: number;
  readonly pointsAwarded: number;
  /** Snapshotted so stats survive the chore being deleted. */
  readonly choreTitle: string;
  readonly assetId: string;
}
