/** `mutationId`s and fresh instance ids both come from here. */
export function newId(): string {
  return crypto.randomUUID();
}
