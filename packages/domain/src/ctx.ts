/** The only way a domain rule learns the time. Never call Date.now() in this package. */
export interface DomainCtx {
  readonly now: number;
  readonly timeZone: string;
}
